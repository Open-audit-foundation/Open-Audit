//! Lexer — converts a DSL source string into a flat `Vec<Token>`.
//!
//! The lexer is a hand-written single-pass scanner.  It produces tokens
//! with their source spans so the parser can emit precise error messages.

use crate::error::{DslError, DslResult, Span};

// ── Token kinds ───────────────────────────────────────────────────────────────

/// Every token kind the DSL grammar uses.
#[derive(Debug, Clone, PartialEq)]
pub enum TokenKind {
    // ── Literals ───────────────────────────────────────────────────────────
    Integer(i128),
    Float(f64),
    StringLit(String),
    True,
    False,
    Null,

    // ── Identifiers & keywords ─────────────────────────────────────────────
    Ident(String),
    Let,
    Return,
    If,
    Else,

    // ── Arithmetic ─────────────────────────────────────────────────────────
    Plus,      // +
    Minus,     // -
    Star,      // *
    Slash,     // /
    Percent,   // %

    // ── Comparison ─────────────────────────────────────────────────────────
    EqEq,      // ==
    BangEq,    // !=
    Lt,        // <
    LtEq,      // <=
    Gt,        // >
    GtEq,      // >=

    // ── Logical ────────────────────────────────────────────────────────────
    Bang,      // !
    AmpAmp,    // &&
    PipePipe,  // ||

    // ── Punctuation ────────────────────────────────────────────────────────
    Eq,        // =
    Semicolon, // ;
    Comma,     // ,
    Dot,       // .
    LParen,    // (
    RParen,    // )
    LBrace,    // {
    RBrace,    // }
    LBracket,  // [
    RBracket,  // ]

    // ── Sentinel ───────────────────────────────────────────────────────────
    Eof,
}

/// A single token with its kind and source span.
#[derive(Debug, Clone, PartialEq)]
pub struct Token {
    pub kind: TokenKind,
    pub span: Span,
}

impl Token {
    fn new(kind: TokenKind, start: usize, end: usize) -> Self {
        Self { kind, span: Span::new(start, end) }
    }
}

// ── Lexer ─────────────────────────────────────────────────────────────────────

/// Maximum number of tokens accepted from a single source string.
/// Prevents O(n) parse-time attacks via absurdly long inputs.
pub const MAX_TOKENS: usize = 4_096;

pub struct Lexer<'src> {
    src:  &'src str,
    /// Byte position of the *next* character to examine.
    pos:  usize,
}

impl<'src> Lexer<'src> {
    pub fn new(src: &'src str) -> Self {
        Self { src, pos: 0 }
    }

    /// Consume the entire input and return all tokens (including a final Eof).
    pub fn tokenize(mut self) -> DslResult<Vec<Token>> {
        let mut tokens = Vec::new();

        loop {
            self.skip_whitespace_and_comments();

            if self.pos >= self.src.len() {
                tokens.push(Token::new(TokenKind::Eof, self.pos, self.pos));
                break;
            }

            let tok = self.next_token()?;
            tokens.push(tok);

            if tokens.len() > MAX_TOKENS {
                return Err(DslError::ProgramTooLong {
                    len:   tokens.len(),
                    limit: MAX_TOKENS,
                });
            }
        }

        Ok(tokens)
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    fn peek(&self) -> Option<char> {
        self.src[self.pos..].chars().next()
    }

    fn peek2(&self) -> Option<char> {
        let mut chars = self.src[self.pos..].chars();
        chars.next();
        chars.next()
    }

    fn advance(&mut self) -> Option<char> {
        let ch = self.peek()?;
        self.pos += ch.len_utf8();
        Some(ch)
    }

    fn matches(&mut self, expected: char) -> bool {
        if self.peek() == Some(expected) {
            self.advance();
            true
        } else {
            false
        }
    }

    fn skip_whitespace_and_comments(&mut self) {
        loop {
            // Whitespace
            while self.peek().map(|c| c.is_ascii_whitespace()).unwrap_or(false) {
                self.advance();
            }
            // Line comment  // …
            if self.peek() == Some('/') && self.peek2() == Some('/') {
                while self.peek().map(|c| c != '\n').unwrap_or(false) {
                    self.advance();
                }
                continue;
            }
            break;
        }
    }

    fn next_token(&mut self) -> DslResult<Token> {
        let start = self.pos;
        let ch = self.advance().unwrap(); // caller ensures pos < len

        let kind = match ch {
            // Single-char punctuation
            '+' => TokenKind::Plus,
            '-' => TokenKind::Minus,
            '*' => TokenKind::Star,
            '/' => TokenKind::Slash,
            '%' => TokenKind::Percent,
            ';' => TokenKind::Semicolon,
            ',' => TokenKind::Comma,
            '.' => TokenKind::Dot,
            '(' => TokenKind::LParen,
            ')' => TokenKind::RParen,
            '{' => TokenKind::LBrace,
            '}' => TokenKind::RBrace,
            '[' => TokenKind::LBracket,
            ']' => TokenKind::RBracket,

            // One-or-two char operators
            '=' => if self.matches('=') { TokenKind::EqEq    } else { TokenKind::Eq      },
            '!' => if self.matches('=') { TokenKind::BangEq  } else { TokenKind::Bang     },
            '<' => if self.matches('=') { TokenKind::LtEq    } else { TokenKind::Lt       },
            '>' => if self.matches('=') { TokenKind::GtEq    } else { TokenKind::Gt       },
            '&' => if self.matches('&') { TokenKind::AmpAmp  } else {
                return Err(DslError::UnexpectedChar { ch: '&', pos: start });
            },
            '|' => if self.matches('|') { TokenKind::PipePipe } else {
                return Err(DslError::UnexpectedChar { ch: '|', pos: start });
            },

            // String literal
            '"' => self.lex_string(start)?,

            // Number
            c if c.is_ascii_digit() || (c == '-' && self.peek().map(|p| p.is_ascii_digit()).unwrap_or(false)) => {
                self.lex_number(start, c)?
            }

            // Identifier or keyword
            c if c.is_ascii_alphabetic() || c == '_' => self.lex_ident(start, c),

            other => return Err(DslError::UnexpectedChar { ch: other, pos: start }),
        };

        Ok(Token::new(kind, start, self.pos))
    }

    fn lex_string(&mut self, start: usize) -> DslResult<TokenKind> {
        let mut s = String::new();
        loop {
            match self.advance() {
                None | Some('\n') => {
                    return Err(DslError::UnterminatedString { start });
                }
                Some('"') => break,
                Some('\\') => {
                    match self.advance() {
                        Some('n')  => s.push('\n'),
                        Some('t')  => s.push('\t'),
                        Some('\\') => s.push('\\'),
                        Some('"')  => s.push('"'),
                        Some(c)    => { s.push('\\'); s.push(c); }
                        None       => return Err(DslError::UnterminatedString { start }),
                    }
                }
                Some(c) => s.push(c),
            }
        }
        Ok(TokenKind::StringLit(s))
    }

    fn lex_number(&mut self, start: usize, first: char) -> DslResult<TokenKind> {
        let mut raw = String::new();
        raw.push(first);

        while self.peek().map(|c| c.is_ascii_digit()).unwrap_or(false) {
            raw.push(self.advance().unwrap());
        }

        // Float if followed by '.' then digit
        if self.peek() == Some('.') && self.peek2().map(|c| c.is_ascii_digit()).unwrap_or(false) {
            raw.push(self.advance().unwrap()); // consume '.'
            while self.peek().map(|c| c.is_ascii_digit()).unwrap_or(false) {
                raw.push(self.advance().unwrap());
            }
            let f: f64 = raw.parse().map_err(|_| DslError::UnexpectedChar { ch: '.', pos: start })?;
            return Ok(TokenKind::Float(f));
        }

        let n: i128 = raw.parse().map_err(|_| DslError::UnexpectedToken {
            got: raw.clone(),
            expected: "integer literal".into(),
            span: Span::new(start, self.pos),
        })?;
        Ok(TokenKind::Integer(n))
    }

    fn lex_ident(&mut self, _start: usize, first: char) -> TokenKind {
        let mut name = String::new();
        name.push(first);
        while self.peek().map(|c| c.is_ascii_alphanumeric() || c == '_').unwrap_or(false) {
            name.push(self.advance().unwrap());
        }
        match name.as_str() {
            "let"    => TokenKind::Let,
            "return" => TokenKind::Return,
            "if"     => TokenKind::If,
            "else"   => TokenKind::Else,
            "true"   => TokenKind::True,
            "false"  => TokenKind::False,
            "null"   => TokenKind::Null,
            _        => TokenKind::Ident(name),
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::DslError;

    // ── Helper ────────────────────────────────────────────────────────────────

    fn kinds(src: &str) -> Vec<TokenKind> {
        Lexer::new(src)
            .tokenize()
            .unwrap()
            .into_iter()
            .map(|t| t.kind)
            .collect()
    }

    fn tokenize_err(src: &str) -> DslError {
        Lexer::new(src).tokenize().unwrap_err()
    }

    // ── Literals ──────────────────────────────────────────────────────────────

    #[test]
    fn lex_integer_positive() {
        assert_eq!(kinds("42"), vec![TokenKind::Integer(42), TokenKind::Eof]);
    }

    #[test]
    fn lex_integer_zero() {
        assert_eq!(kinds("0"), vec![TokenKind::Integer(0), TokenKind::Eof]);
    }

    #[test]
    fn lex_large_integer() {
        // 10_000_000 stroops — common Soroban amount
        assert_eq!(kinds("10000000"), vec![TokenKind::Integer(10_000_000), TokenKind::Eof]);
    }

    #[test]
    fn lex_float() {
        let toks = kinds("3.14");
        match &toks[0] {
            TokenKind::Float(f) => assert!((*f - 3.14_f64).abs() < 1e-10),
            other => panic!("expected Float, got {:?}", other),
        }
    }

    #[test]
    fn lex_string_literal() {
        assert_eq!(
            kinds(r#""hello world""#),
            vec![TokenKind::StringLit("hello world".into()), TokenKind::Eof]
        );
    }

    #[test]
    fn lex_string_escape_sequences() {
        let toks = kinds(r#""line1\nline2""#);
        assert_eq!(toks[0], TokenKind::StringLit("line1\nline2".into()));
    }

    #[test]
    fn lex_string_escaped_quote() {
        let toks = kinds(r#""say \"hi\"""#);
        assert_eq!(toks[0], TokenKind::StringLit("say \"hi\"".into()));
    }

    #[test]
    fn lex_bool_true() {
        assert_eq!(kinds("true"), vec![TokenKind::True, TokenKind::Eof]);
    }

    #[test]
    fn lex_bool_false() {
        assert_eq!(kinds("false"), vec![TokenKind::False, TokenKind::Eof]);
    }

    #[test]
    fn lex_null() {
        assert_eq!(kinds("null"), vec![TokenKind::Null, TokenKind::Eof]);
    }

    // ── Keywords ──────────────────────────────────────────────────────────────

    #[test]
    fn lex_keywords() {
        let k = kinds("let return if else");
        assert_eq!(k, vec![
            TokenKind::Let,
            TokenKind::Return,
            TokenKind::If,
            TokenKind::Else,
            TokenKind::Eof,
        ]);
    }

    // ── Identifiers ───────────────────────────────────────────────────────────

    #[test]
    fn lex_identifier() {
        assert_eq!(kinds("amount"), vec![TokenKind::Ident("amount".into()), TokenKind::Eof]);
    }

    #[test]
    fn lex_identifier_with_underscore() {
        assert_eq!(kinds("my_var_1"), vec![TokenKind::Ident("my_var_1".into()), TokenKind::Eof]);
    }

    // ── Operators ─────────────────────────────────────────────────────────────

    #[test]
    fn lex_arithmetic_operators() {
        let k = kinds("+ - * / %");
        assert_eq!(k, vec![
            TokenKind::Plus, TokenKind::Minus, TokenKind::Star,
            TokenKind::Slash, TokenKind::Percent, TokenKind::Eof,
        ]);
    }

    #[test]
    fn lex_comparison_operators() {
        let k = kinds("== != < <= > >=");
        assert_eq!(k, vec![
            TokenKind::EqEq, TokenKind::BangEq,
            TokenKind::Lt, TokenKind::LtEq,
            TokenKind::Gt, TokenKind::GtEq,
            TokenKind::Eof,
        ]);
    }

    #[test]
    fn lex_logical_operators() {
        let k = kinds("! && ||");
        assert_eq!(k, vec![
            TokenKind::Bang, TokenKind::AmpAmp, TokenKind::PipePipe, TokenKind::Eof,
        ]);
    }

    #[test]
    fn lex_punctuation() {
        let k = kinds("= ; , . ( ) { } [ ]");
        assert_eq!(k, vec![
            TokenKind::Eq, TokenKind::Semicolon, TokenKind::Comma, TokenKind::Dot,
            TokenKind::LParen, TokenKind::RParen, TokenKind::LBrace, TokenKind::RBrace,
            TokenKind::LBracket, TokenKind::RBracket, TokenKind::Eof,
        ]);
    }

    // ── Whitespace & comments ─────────────────────────────────────────────────

    #[test]
    fn lex_skips_whitespace() {
        let k = kinds("  42  ");
        assert_eq!(k, vec![TokenKind::Integer(42), TokenKind::Eof]);
    }

    #[test]
    fn lex_skips_line_comments() {
        let k = kinds("42 // this is a comment\n+ 1");
        assert_eq!(k, vec![
            TokenKind::Integer(42), TokenKind::Plus, TokenKind::Integer(1), TokenKind::Eof,
        ]);
    }

    #[test]
    fn lex_multiline_program() {
        let src = "let x = 1 ;\nreturn x ;";
        let k = kinds(src);
        assert_eq!(k, vec![
            TokenKind::Let,
            TokenKind::Ident("x".into()),
            TokenKind::Eq,
            TokenKind::Integer(1),
            TokenKind::Semicolon,
            TokenKind::Return,
            TokenKind::Ident("x".into()),
            TokenKind::Semicolon,
            TokenKind::Eof,
        ]);
    }

    // ── Source spans ──────────────────────────────────────────────────────────

    #[test]
    fn lex_span_accuracy() {
        let tokens = Lexer::new("42 + 7").tokenize().unwrap();
        // "42" starts at 0, ends at 2
        assert_eq!(tokens[0].span.start, 0);
        assert_eq!(tokens[0].span.end,   2);
        // "+" starts at 3
        assert_eq!(tokens[1].span.start, 3);
        // "7" starts at 5
        assert_eq!(tokens[2].span.start, 5);
    }

    // ── Error cases ───────────────────────────────────────────────────────────

    #[test]
    fn lex_error_unexpected_char() {
        let err = tokenize_err("42 @ 1");
        assert!(matches!(err, DslError::UnexpectedChar { ch: '@', .. }));
    }

    #[test]
    fn lex_error_single_ampersand() {
        let err = tokenize_err("a & b");
        assert!(matches!(err, DslError::UnexpectedChar { ch: '&', .. }));
    }

    #[test]
    fn lex_error_single_pipe() {
        let err = tokenize_err("a | b");
        assert!(matches!(err, DslError::UnexpectedChar { ch: '|', .. }));
    }

    #[test]
    fn lex_error_unterminated_string() {
        let err = tokenize_err(r#""not closed"#);
        assert!(matches!(err, DslError::UnterminatedString { .. }));
    }

    #[test]
    fn lex_error_string_with_newline_inside() {
        let err = tokenize_err("\"line1\nline2\"");
        assert!(matches!(err, DslError::UnterminatedString { .. }));
    }

    #[test]
    fn lex_error_program_too_long() {
        // Build a token stream slightly over the limit
        let src = "42 ; ".repeat(MAX_TOKENS / 2 + 10);
        let err = Lexer::new(&src).tokenize().unwrap_err();
        assert!(matches!(err, DslError::ProgramTooLong { .. }));
    }
}
