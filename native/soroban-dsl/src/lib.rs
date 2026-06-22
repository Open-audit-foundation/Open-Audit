//! soroban-dsl — Translation DSL for Soroban contract events.
//!
//! # DSL Specification (informal grammar)
//!
//! ```text
//! program   ::= stmt*
//! stmt      ::= LET IDENT '=' expr ';'
//!             | RETURN expr ';'
//!             | IF expr '{' stmt* '}' ( ELSE '{' stmt* '}' )?
//!
//! expr      ::= equality
//! equality  ::= comparison ( ('==' | '!=') comparison )*
//! comparison::= addition  ( ('<' | '<=' | '>' | '>=') addition )*
//! addition  ::= multiply  ( ('+' | '-') multiply )*
//! multiply  ::= unary     ( ('*' | '/' | '%') unary )*
//! unary     ::= '-' unary | '!' unary | postfix
//! postfix   ::= primary ( '.' IDENT | '[' expr ']' )*
//! primary   ::= INTEGER | FLOAT | STRING | BOOL | NULL | IDENT
//!             | '(' expr ')'
//!             | BUILTIN '(' args ')'
//!
//! args      ::= ( expr ( ',' expr )* )?
//!
//! BUILTIN   ::= "format_amount" | "shorten" | "to_string" | "concat"
//!             | "if_else"
//! ```
//!
//! # Security guarantees
//!
//! * Maximum AST depth: 32 levels — prevents stack overflow on recursive input.
//! * Maximum program length: 4 096 tokens — prevents runaway parse time.
//! * Evaluation step budget: 1 000 — prevents infinite loops.
//! * All accessor paths are type-checked at evaluation time; unknown fields
//!   return a typed `EvalError` rather than panicking.
//! * No `eval()`, `unsafe`, or dynamic dispatch to user-controlled code.

pub mod error;
pub mod lexer;
pub mod parser;
pub mod eval;
pub mod scval;

pub use error::{DslError, DslResult};
pub use eval::{Evaluator, EvalContext};
pub use lexer::Lexer;
pub use parser::Parser;
pub use scval::ScVal;

/// Convenience entry-point: compile and immediately evaluate a DSL program.
///
/// ```rust
/// use soroban_dsl::{run, ScVal, EvalContext};
///
/// let mut ctx = EvalContext::new();
/// ctx.bind("amount", ScVal::I128(10_000_000));
/// ctx.bind("from",   ScVal::Address("GABC...1234".into()));
///
/// let result = run("return format_amount(amount, 7) ;", &ctx).unwrap();
/// assert_eq!(result, "1.0000000");
/// ```
pub fn run(source: &str, ctx: &EvalContext) -> DslResult<String> {
    let tokens = Lexer::new(source).tokenize()?;
    let ast    = Parser::new(&tokens).parse()?;
    Evaluator::new(ctx).execute(&ast)
}

// Integration tests live in the #[cfg(test)] blocks at the bottom of each
// module (idiomatic Rust).  End-to-end tests covering the full pipeline are
// in eval.rs under its own test module.
