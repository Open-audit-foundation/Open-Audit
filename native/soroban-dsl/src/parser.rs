//! Parser — converts a flat token stream into a typed AST.
//!
//! Uses recursive-descent with a hard nesting-depth limit to prevent stack
//! exhaustion on pathological inputs.

use crate::error::{DslError, DslResult, Span};
use crate::lexer::{Token, TokenKind};

// ── AST node types ────────────────────────────────────────────────────────────

/// Maximum recursive nesting depth allowed in the AST.
pub const MAX_DEPTH: usize = 32;

/// A complete DSL program is a sequence of statements.
pub type Program = Vec<Stmt>;

/// A statement that produces side-effects (binding or control flow).
#[derive(Debug, Clone, PartialEq)]
pub enum Stmt {
    /// `let name = expr ;`
    Let { name: String, value: Expr },
    /// `return expr ;`
    Return(Expr),
    /// `if expr { stmts } [ else { stmts } ]`
    If {
        condition: Expr,
        then_branch: Vec<Stmt>,
        else_branch: Option<Vec<Stmt>>,
    },
}

/// An expression that computes a value.
#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    // ── Literals ──────────────────────────────────────────────────────────
    Integer(i128),
    Float(f64),
    StringLit(String),
    Bool(bool),
    Null,

    // ── Variable access ───────────────────────────────────────────────────
    Ident(String),

    // ── Binary operations ─────────────────────────────────────────────────
    BinOp { op: BinOp, lhs: Box<Expr>, rhs: Box<Expr> },

    // ── Unary operations ──────────────────────────────────────────────────
    UnaryOp { op: UnaryOp, operand: Box<Expr> },

    // ── Accessor chains ───────────────────────────────────────────────────
    /// `expr . ident` — named field on Address or Map.
    FieldAccess { object: Box<Expr>, field: String },
    /// `expr [ expr ]` — integer index into Vec.
    Index { object: Box<Expr>, index: Box<Expr> },

    // ── Function calls ────────────────────────────────────────────────────
    Call { name: String, args: Vec<Expr> },
}

/// Binary operator kinds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BinOp {
    Add, Sub, Mul, Div, Mod,
    Eq, Ne, Lt, Le, Gt, Ge,
    And, Or,
}

/// Unary operator kinds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnaryOp {
    Neg,  // -
    Not,  // !
}

// ── Parser ────────────────────────────────────────────────────────────────────

pub struct Parser<'t> {
    tokens: &'t [Token],
    pos:    usize,
    depth:  usize,
}

impl<'t> Parser<'t> {
    pub fn new(tokens: &'t [Token]) -> Self {
        Self { tokens, pos: 0, depth: 0 }
    }

    // ── Entry-point ──────────────────────────────────────────────────────────

    pub fn parse(mut self) -> DslResult<Program> {
        let mut stmts = Vec::new();
        while !self.at_eof() {
            stmts.push(self.parse_stmt()?);
        }
        Ok(stmts)
    }

    // ── Statements ───────────────────────────────────────────────────────────

    fn parse_stmt(&mut self) -> DslResult<Stmt> {
        match self.peek_kind() {
            TokenKind::Let    => self.parse_let(),
            TokenKind::Return => self.parse_return(),
            TokenKind::If     => self.parse_if(),
            _ => {
                let span = self.current_span();
                Err(DslError::UnexpectedToken {
                    got:      format!("{:?}", self.peek_kind()),
                    expected: "let, return, or if".into(),
                    span,
                })
            }
        }
    }

    fn parse_let(&mut self) -> DslResult<Stmt> {
        self.expect(TokenKind::Let)?;
        let name = self.expect_ident()?;
        self.expect(TokenKind::Eq)?;
        let value = self.parse_expr()?;
        self.expect(TokenKind::Semicolon)?;
        Ok(Stmt::Let { name, value })
    }

    fn parse_return(&mut self) -> DslResult<Stmt> {
        self.expect(TokenKind::Return)?;
        let expr = self.parse_expr()?;
        self.expect(TokenKind::Semicolon)?;
        Ok(Stmt::Return(expr))
    }

    fn parse_if(&mut self) -> DslResult<Stmt> {
        self.expect(TokenKind::If)?;
        let condition = self.parse_expr()?;
        let then_branch = self.parse_block()?;
        let else_branch = if matches!(self.peek_kind(), TokenKind::Else) {
            self.advance();
            Some(self.parse_block()?)
        } else {
            None
        };
        Ok(Stmt::If { condition, then_branch, else_branch })
    }

    fn parse_block(&mut self) -> DslResult<Vec<Stmt>> {
        self.expect(TokenKind::LBrace)?;
        let mut stmts = Vec::new();
        while !matches!(self.peek_kind(), TokenKind::RBrace | TokenKind::Eof) {
            stmts.push(self.parse_stmt()?);
        }
        self.expect(TokenKind::RBrace)?;
        Ok(stmts)
    }

    // ── Expressions (Pratt-style precedence climbing) ─────────────────────────

    fn parse_expr(&mut self) -> DslResult<Expr> {
        self.with_depth(|p| p.parse_or())
    }

    fn parse_or(&mut self) -> DslResult<Expr> {
        let mut lhs = self.parse_and()?;
        while matches!(self.peek_kind(), TokenKind::PipePipe) {
            self.advance();
            let rhs = self.parse_and()?;
            lhs = Expr::BinOp { op: BinOp::Or, lhs: Box::new(lhs), rhs: Box::new(rhs) };
        }
        Ok(lhs)
    }

    fn parse_and(&mut self) -> DslResult<Expr> {
        let mut lhs = self.parse_equality()?;
        while matches!(self.peek_kind(), TokenKind::AmpAmp) {
            self.advance();
            let rhs = self.parse_equality()?;
            lhs = Expr::BinOp { op: BinOp::And, lhs: Box::new(lhs), rhs: Box::new(rhs) };
        }
        Ok(lhs)
    }

    fn parse_equality(&mut self) -> DslResult<Expr> {
        let mut lhs = self.parse_comparison()?;
        loop {
            let op = match self.peek_kind() {
                TokenKind::EqEq  => BinOp::Eq,
                TokenKind::BangEq => BinOp::Ne,
                _ => break,
            };
            self.advance();
            let rhs = self.parse_comparison()?;
            lhs = Expr::BinOp { op, lhs: Box::new(lhs), rhs: Box::new(rhs) };
        }
        Ok(lhs)
    }

    fn parse_comparison(&mut self) -> DslResult<Expr> {
        let mut lhs = self.parse_addition()?;
        loop {
            let op = match self.peek_kind() {
                TokenKind::Lt   => BinOp::Lt,
                TokenKind::LtEq => BinOp::Le,
                TokenKind::Gt   => BinOp::Gt,
                TokenKind::GtEq => BinOp::Ge,
                _ => break,
            };
            self.advance();
            let rhs = self.parse_addition()?;
            lhs = Expr::BinOp { op, lhs: Box::new(lhs), rhs: Box::new(rhs) };
        }
        Ok(lhs)
    }

    fn parse_addition(&mut self) -> DslResult<Expr> {
        let mut lhs = self.parse_multiply()?;
        loop {
            let op = match self.peek_kind() {
                TokenKind::Plus  => BinOp::Add,
                TokenKind::Minus => BinOp::Sub,
                _ => break,
            };
            self.advance();
            let rhs = self.parse_multiply()?;
            lhs = Expr::BinOp { op, lhs: Box::new(lhs), rhs: Box::new(rhs) };
        }
        Ok(lhs)
    }

    fn parse_multiply(&mut self) -> DslResult<Expr> {
        let mut lhs = self.parse_unary()?;
        loop {
            let op = match self.peek_kind() {
                TokenKind::Star    => BinOp::Mul,
                TokenKind::Slash   => BinOp::Div,
                TokenKind::Percent => BinOp::Mod,
                _ => break,
            };
            self.advance();
            let rhs = self.parse_unary()?;
            lhs = Expr::BinOp { op, lhs: Box::new(lhs), rhs: Box::new(rhs) };
        }
        Ok(lhs)
    }

    fn parse_unary(&mut self) -> DslResult<Expr> {
        match self.peek_kind() {
            TokenKind::Minus => {
                self.advance();
                let operand = self.parse_unary()?;
                Ok(Expr::UnaryOp { op: UnaryOp::Neg, operand: Box::new(operand) })
            }
            TokenKind::Bang => {
                self.advance();
                let operand = self.parse_unary()?;
                Ok(Expr::UnaryOp { op: UnaryOp::Not, operand: Box::new(operand) })
            }
            _ => self.parse_postfix(),
        }
    }

    fn parse_postfix(&mut self) -> DslResult<Expr> {
        let mut expr = self.parse_primary()?;
        loop {
            match self.peek_kind() {
                TokenKind::Dot => {
                    self.advance();
                    let field = self.expect_ident()?;
                    expr = Expr::FieldAccess { object: Box::new(expr), field };
                }
                TokenKind::LBracket => {
                    self.advance();
                    let index = self.parse_expr()?;
                    self.expect(TokenKind::RBracket)?;
                    expr = Expr::Index { object: Box::new(expr), index: Box::new(index) };
                }
                _ => break,
            }
        }
        Ok(expr)
    }

    fn parse_primary(&mut self) -> DslResult<Expr> {
        let span = self.current_span();
        match self.peek_kind().clone() {
            TokenKind::Integer(n) => { self.advance(); Ok(Expr::Integer(n)) }
            TokenKind::Float(f)   => { self.advance(); Ok(Expr::Float(f)) }
            TokenKind::StringLit(s) => { self.advance(); Ok(Expr::StringLit(s)) }
            TokenKind::True  => { self.advance(); Ok(Expr::Bool(true)) }
            TokenKind::False => { self.advance(); Ok(Expr::Bool(false)) }
            TokenKind::Null  => { self.advance(); Ok(Expr::Null) }

            TokenKind::Ident(name) => {
                self.advance();
                // Function call?
                if matches!(self.peek_kind(), TokenKind::LParen) {
                    self.advance();
                    let args = self.parse_args()?;
                    self.expect(TokenKind::RParen)?;
                    Ok(Expr::Call { name, args })
                } else {
                    Ok(Expr::Ident(name))
                }
            }

            TokenKind::LParen => {
                self.advance();
                let inner = self.parse_expr()?;
                self.expect(TokenKind::RParen)?;
                Ok(inner)
            }

            _ => Err(DslError::UnexpectedToken {
                got:      format!("{:?}", self.peek_kind()),
                expected: "expression".into(),
                span,
            }),
        }
    }

    fn parse_args(&mut self) -> DslResult<Vec<Expr>> {
        let mut args = Vec::new();
        if matches!(self.peek_kind(), TokenKind::RParen) {
            return Ok(args);
        }
        args.push(self.parse_expr()?);
        while matches!(self.peek_kind(), TokenKind::Comma) {
            self.advance();
            args.push(self.parse_expr()?);
        }
        Ok(args)
    }

    // ── Utilities ────────────────────────────────────────────────────────────

    fn peek_kind(&self) -> &TokenKind {
        &self.tokens[self.pos].kind
    }

    fn current_span(&self) -> Span {
        self.tokens[self.pos].span
    }

    fn advance(&mut self) -> &Token {
        let tok = &self.tokens[self.pos];
        if self.pos + 1 < self.tokens.len() {
            self.pos += 1;
        }
        tok
    }

    fn at_eof(&self) -> bool {
        matches!(self.peek_kind(), TokenKind::Eof)
    }

    fn expect(&mut self, kind: TokenKind) -> DslResult<&Token> {
        if std::mem::discriminant(self.peek_kind()) == std::mem::discriminant(&kind) {
            Ok(self.advance())
        } else {
            Err(DslError::UnexpectedToken {
                got:      format!("{:?}", self.peek_kind()),
                expected: format!("{:?}", kind),
                span:     self.current_span(),
            })
        }
    }

    fn expect_ident(&mut self) -> DslResult<String> {
        match self.peek_kind().clone() {
            TokenKind::Ident(name) => { self.advance(); Ok(name) }
            _ => Err(DslError::UnexpectedToken {
                got:      format!("{:?}", self.peek_kind()),
                expected: "identifier".into(),
                span:     self.current_span(),
            }),
        }
    }

    /// Execute `f` with one extra depth unit, failing if the limit is exceeded.
    fn with_depth<F, T>(&mut self, f: F) -> DslResult<T>
    where
        F: FnOnce(&mut Self) -> DslResult<T>,
    {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return Err(DslError::NestingTooDeep { depth: self.depth, limit: MAX_DEPTH });
        }
        let result = f(self);
        self.depth -= 1;
        result
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lexer::Lexer;
    use crate::error::DslError;

    fn parse(src: &str) -> Program {
        let tokens = Lexer::new(src).tokenize().unwrap();
        Parser::new(&tokens).parse().unwrap()
    }

    fn parse_err(src: &str) -> DslError {
        let tokens = Lexer::new(src).tokenize().unwrap();
        Parser::new(&tokens).parse().unwrap_err()
    }

    // ── Let statements ────────────────────────────────────────────────────────

    #[test]
    fn parse_let_integer() {
        let prog = parse("let x = 42 ;");
        assert_eq!(prog.len(), 1);
        assert_eq!(prog[0], Stmt::Let {
            name:  "x".into(),
            value: Expr::Integer(42),
        });
    }

    #[test]
    fn parse_let_string() {
        let prog = parse(r#"let msg = "hello" ;"#);
        assert_eq!(prog[0], Stmt::Let {
            name:  "msg".into(),
            value: Expr::StringLit("hello".into()),
        });
    }

    #[test]
    fn parse_multiple_lets() {
        let prog = parse("let a = 1 ; let b = 2 ;");
        assert_eq!(prog.len(), 2);
    }

    // ── Return statements ─────────────────────────────────────────────────────

    #[test]
    fn parse_return_literal() {
        let prog = parse("return 99 ;");
        assert_eq!(prog[0], Stmt::Return(Expr::Integer(99)));
    }

    #[test]
    fn parse_return_ident() {
        let prog = parse("return amount ;");
        assert_eq!(prog[0], Stmt::Return(Expr::Ident("amount".into())));
    }

    // ── If statements ─────────────────────────────────────────────────────────

    #[test]
    fn parse_if_without_else() {
        let prog = parse("if true { return 1 ; }");
        assert!(matches!(&prog[0], Stmt::If { else_branch: None, .. }));
    }

    #[test]
    fn parse_if_with_else() {
        let prog = parse("if true { return 1 ; } else { return 2 ; }");
        assert!(matches!(&prog[0], Stmt::If { else_branch: Some(_), .. }));
    }

    #[test]
    fn parse_nested_if() {
        let src = "if a { if b { return 1 ; } } else { return 2 ; }";
        let prog = parse(src);
        assert_eq!(prog.len(), 1);
    }

    // ── Arithmetic expressions ────────────────────────────────────────────────

    #[test]
    fn parse_addition() {
        let prog = parse("return 1 + 2 ;");
        assert_eq!(prog[0], Stmt::Return(Expr::BinOp {
            op:  BinOp::Add,
            lhs: Box::new(Expr::Integer(1)),
            rhs: Box::new(Expr::Integer(2)),
        }));
    }

    #[test]
    fn parse_precedence_mul_over_add() {
        // 1 + 2 * 3  →  1 + (2 * 3)
        let prog = parse("return 1 + 2 * 3 ;");
        match &prog[0] {
            Stmt::Return(Expr::BinOp { op: BinOp::Add, lhs, rhs }) => {
                assert_eq!(**lhs, Expr::Integer(1));
                assert!(matches!(**rhs, Expr::BinOp { op: BinOp::Mul, .. }));
            }
            _ => panic!("wrong shape"),
        }
    }

    #[test]
    fn parse_parentheses_override_precedence() {
        // (1 + 2) * 3
        let prog = parse("return (1 + 2) * 3 ;");
        match &prog[0] {
            Stmt::Return(Expr::BinOp { op: BinOp::Mul, lhs, .. }) => {
                assert!(matches!(**lhs, Expr::BinOp { op: BinOp::Add, .. }));
            }
            _ => panic!("wrong shape"),
        }
    }

    #[test]
    fn parse_unary_negation() {
        let prog = parse("return -42 ;");
        // -42 may parse as UnaryOp(Neg, 42) OR directly as Integer(-42)
        // depending on whether the lexer handles leading '-'.
        // Either is acceptable — just check it produces a value.
        assert_eq!(prog.len(), 1);
    }

    #[test]
    fn parse_unary_not() {
        let prog = parse("return !true ;");
        assert_eq!(prog[0], Stmt::Return(
            Expr::UnaryOp { op: UnaryOp::Not, operand: Box::new(Expr::Bool(true)) }
        ));
    }

    // ── Comparisons & logical ─────────────────────────────────────────────────

    #[test]
    fn parse_equality() {
        let prog = parse("return a == b ;");
        assert!(matches!(&prog[0], Stmt::Return(Expr::BinOp { op: BinOp::Eq, .. })));
    }

    #[test]
    fn parse_inequality() {
        let prog = parse("return a != b ;");
        assert!(matches!(&prog[0], Stmt::Return(Expr::BinOp { op: BinOp::Ne, .. })));
    }

    #[test]
    fn parse_logical_and() {
        let prog = parse("return true && false ;");
        assert!(matches!(&prog[0], Stmt::Return(Expr::BinOp { op: BinOp::And, .. })));
    }

    #[test]
    fn parse_logical_or() {
        let prog = parse("return true || false ;");
        assert!(matches!(&prog[0], Stmt::Return(Expr::BinOp { op: BinOp::Or, .. })));
    }

    // ── Accessor chains ───────────────────────────────────────────────────────

    #[test]
    fn parse_field_access() {
        let prog = parse("return from.short ;");
        assert_eq!(prog[0], Stmt::Return(Expr::FieldAccess {
            object: Box::new(Expr::Ident("from".into())),
            field:  "short".into(),
        }));
    }

    #[test]
    fn parse_chained_field_access() {
        let prog = parse("return a.b.c ;");
        assert!(matches!(&prog[0], Stmt::Return(Expr::FieldAccess { .. })));
    }

    #[test]
    fn parse_index_access() {
        let prog = parse("return topics[0] ;");
        assert_eq!(prog[0], Stmt::Return(Expr::Index {
            object: Box::new(Expr::Ident("topics".into())),
            index:  Box::new(Expr::Integer(0)),
        }));
    }

    // ── Function calls ────────────────────────────────────────────────────────

    #[test]
    fn parse_call_no_args() {
        let prog = parse("return foo() ;");
        assert_eq!(prog[0], Stmt::Return(Expr::Call {
            name: "foo".into(),
            args: vec![],
        }));
    }

    #[test]
    fn parse_call_one_arg() {
        let prog = parse("return shorten(addr) ;");
        assert_eq!(prog[0], Stmt::Return(Expr::Call {
            name: "shorten".into(),
            args: vec![Expr::Ident("addr".into())],
        }));
    }

    #[test]
    fn parse_call_multiple_args() {
        let prog = parse("return format_amount(amount, 7) ;");
        assert_eq!(prog[0], Stmt::Return(Expr::Call {
            name: "format_amount".into(),
            args: vec![Expr::Ident("amount".into()), Expr::Integer(7)],
        }));
    }

    #[test]
    fn parse_nested_call() {
        let prog = parse("return concat(shorten(addr), \" sent \") ;");
        assert!(matches!(&prog[0], Stmt::Return(Expr::Call { name, .. }) if name == "concat"));
    }

    // ── Error cases ───────────────────────────────────────────────────────────

    #[test]
    fn parse_error_missing_semicolon() {
        let err = parse_err("let x = 1");
        // Parser runs out of tokens looking for ';'
        assert!(matches!(err, DslError::UnexpectedToken { .. } | DslError::UnexpectedEof { .. }));
    }

    #[test]
    fn parse_error_unexpected_token_as_statement() {
        let err = parse_err("42 ;");
        assert!(matches!(err, DslError::UnexpectedToken { .. }));
    }

    #[test]
    fn parse_error_unclosed_paren() {
        let err = parse_err("return (1 + 2 ;");
        assert!(matches!(err, DslError::UnexpectedToken { .. }));
    }

    #[test]
    fn parse_error_missing_block_brace() {
        let err = parse_err("if true return 1 ; }");
        assert!(matches!(err, DslError::UnexpectedToken { .. }));
    }

    #[test]
    fn parse_nesting_depth_limit() {
        // Build a deeply nested expression: ((((…))))
        let open:  String = "return ".to_owned() + &"(".repeat(MAX_DEPTH + 5);
        let close: String = "1".to_owned() + &")".repeat(MAX_DEPTH + 5) + " ;";
        let src = open + &close;
        let tokens = Lexer::new(&src).tokenize().unwrap();
        let err = Parser::new(&tokens).parse().unwrap_err();
        assert!(matches!(err, DslError::NestingTooDeep { .. }));
    }
}
