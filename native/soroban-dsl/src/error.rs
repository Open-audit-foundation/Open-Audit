//! Error types for every phase of the DSL pipeline.

use std::fmt;

/// A positioned source span used in diagnostics.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Span {
    /// Byte offset of the first character.
    pub start: usize,
    /// Byte offset one past the last character.
    pub end: usize,
}

impl Span {
    pub fn new(start: usize, end: usize) -> Self {
        Self { start, end }
    }
    pub fn single(pos: usize) -> Self {
        Self { start: pos, end: pos + 1 }
    }
}

impl fmt::Display for Span {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}..{}", self.start, self.end)
    }
}

/// All errors the DSL pipeline can produce.
#[derive(Debug, Clone, PartialEq)]
pub enum DslError {
    // ── Lexer ──────────────────────────────────────────────────────────────
    /// A character was encountered that does not begin any valid token.
    UnexpectedChar { ch: char, pos: usize },
    /// A string literal was opened but never closed before end-of-input.
    UnterminatedString { start: usize },

    // ── Parser ─────────────────────────────────────────────────────────────
    /// Token stream exceeded the hard length limit.
    ProgramTooLong { len: usize, limit: usize },
    /// Parser ran out of tokens before finishing a production.
    UnexpectedEof { expected: String },
    /// Found a token that does not fit the expected grammar position.
    UnexpectedToken { got: String, expected: String, span: Span },
    /// AST nesting depth exceeded the hard limit.
    NestingTooDeep { depth: usize, limit: usize },

    // ── Evaluator ──────────────────────────────────────────────────────────
    /// Evaluation step budget was exhausted (infinite-loop guard).
    StepBudgetExceeded { budget: usize },
    /// A variable name was accessed that was never bound in the context.
    UndefinedVariable { name: String },
    /// An operation received a value of the wrong ScVal type.
    TypeError { expected: String, got: String, context: String },
    /// Division or modulo by zero.
    DivisionByZero,
    /// A field accessor (`.field`) was used on a type that has no such field.
    NoSuchField { field: String, on_type: String },
    /// An integer index was out of range for a Vec.
    IndexOutOfRange { index: i64, len: usize },
    /// A program produced no `return` statement — the result is undefined.
    NoReturnValue,
    /// An integer overflow occurred during arithmetic.
    Overflow { operation: String },
    /// A format_amount call received a decimal precision outside 0–18.
    InvalidPrecision { precision: i64 },
}

impl fmt::Display for DslError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnexpectedChar { ch, pos } =>
                write!(f, "unexpected character {:?} at byte {}", ch, pos),
            Self::UnterminatedString { start } =>
                write!(f, "unterminated string literal starting at byte {}", start),

            Self::ProgramTooLong { len, limit } =>
                write!(f, "program has {} tokens, limit is {}", len, limit),
            Self::UnexpectedEof { expected } =>
                write!(f, "unexpected end of input, expected {}", expected),
            Self::UnexpectedToken { got, expected, span } =>
                write!(f, "unexpected token {:?} at {}, expected {}", got, span, expected),
            Self::NestingTooDeep { depth, limit } =>
                write!(f, "AST nesting depth {} exceeds limit {}", depth, limit),

            Self::StepBudgetExceeded { budget } =>
                write!(f, "evaluation exceeded {} steps (possible infinite loop)", budget),
            Self::UndefinedVariable { name } =>
                write!(f, "undefined variable {:?}", name),
            Self::TypeError { expected, got, context } =>
                write!(f, "type error in {}: expected {}, got {}", context, expected, got),
            Self::DivisionByZero =>
                write!(f, "division by zero"),
            Self::NoSuchField { field, on_type } =>
                write!(f, "type {} has no field {:?}", on_type, field),
            Self::IndexOutOfRange { index, len } =>
                write!(f, "index {} out of range for vec of length {}", index, len),
            Self::NoReturnValue =>
                write!(f, "program completed without a return statement"),
            Self::Overflow { operation } =>
                write!(f, "integer overflow in operation {:?}", operation),
            Self::InvalidPrecision { precision } =>
                write!(f, "precision {} is out of range (0–18)", precision),
        }
    }
}

impl std::error::Error for DslError {}

pub type DslResult<T> = Result<T, DslError>;
