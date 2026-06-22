//! The DSL's value type — a strict subset of Soroban ScVal.
//!
//! `ScVal` is the runtime value that flows through the evaluator.  It mirrors
//! the Soroban on-chain type system closely enough that field accessors work
//! naturally, while remaining independent of the `stellar-sdk` crate so the
//! DSL can be used in any Rust context (WASM, native, tests).

use std::fmt;
use std::collections::HashMap;

/// Runtime value type for the DSL evaluator.
///
/// All variants are `Clone` so values can be stored in bindings without
/// lifetime complications.
#[derive(Debug, Clone, PartialEq)]
pub enum ScVal {
    // ── Primitives ──────────────────────────────────────────────────────────
    Bool(bool),
    /// Signed 32-bit integer.
    I32(i32),
    /// Unsigned 32-bit integer.
    U32(u32),
    /// Signed 64-bit integer.
    I64(i64),
    /// Unsigned 64-bit integer.
    U64(u64),
    /// Signed 128-bit integer (Soroban token amounts).
    I128(i128),
    /// Unsigned 128-bit integer.
    U128(u128),
    /// Stellar StrKey address (G… or C…).
    Address(String),
    /// UTF-8 symbol, e.g. event discriminant "transfer".
    Symbol(String),
    /// Arbitrary UTF-8 string from the contract.
    Str(String),
    /// Raw bytes (hex-encoded for display).
    Bytes(Vec<u8>),
    /// Void / null sentinel.
    Void,

    // ── Container types ─────────────────────────────────────────────────────
    /// Ordered sequence of ScVals.
    Vec(Vec<ScVal>),
    /// String-keyed map (decoded from ScMap with Symbol keys).
    Map(HashMap<String, ScVal>),
}

impl ScVal {
    /// Short discriminant name, used in error messages.
    pub fn type_name(&self) -> &'static str {
        match self {
            Self::Bool(_)    => "Bool",
            Self::I32(_)     => "I32",
            Self::U32(_)     => "U32",
            Self::I64(_)     => "I64",
            Self::U64(_)     => "U64",
            Self::I128(_)    => "I128",
            Self::U128(_)    => "U128",
            Self::Address(_) => "Address",
            Self::Symbol(_)  => "Symbol",
            Self::Str(_)     => "Str",
            Self::Bytes(_)   => "Bytes",
            Self::Void       => "Void",
            Self::Vec(_)     => "Vec",
            Self::Map(_)     => "Map",
        }
    }

    /// Attempt to coerce to a signed 128-bit integer.
    /// Accepts I32, I64, I128, U32, U64, U128 (checked widening).
    pub fn as_i128(&self) -> Option<i128> {
        match self {
            Self::I32(n)  => Some(*n as i128),
            Self::U32(n)  => Some(*n as i128),
            Self::I64(n)  => Some(*n as i128),
            Self::U64(n)  => Some(*n as i128),
            Self::I128(n) => Some(*n),
            Self::U128(n) => i128::try_from(*n).ok(),
            _ => None,
        }
    }

    /// Attempt to coerce to a bool.
    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Self::Bool(b) => Some(*b),
            _ => None,
        }
    }

    /// Extract the inner string from Address, Symbol, or Str.
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Self::Address(s) | Self::Symbol(s) | Self::Str(s) => Some(s.as_str()),
            _ => None,
        }
    }

    /// Truthiness: only `Bool(false)` and `Void` are falsy.
    pub fn is_truthy(&self) -> bool {
        match self {
            Self::Bool(b) => *b,
            Self::Void    => false,
            _             => true,
        }
    }

    /// Access a named field. Supported on Address (.short, .full) and Map.
    pub fn get_field(&self, field: &str) -> Option<ScVal> {
        match self {
            Self::Address(addr) => match field {
                "full"  => Some(Self::Str(addr.clone())),
                "short" => Some(Self::Str(shorten_address(addr))),
                _ => None,
            },
            Self::Map(m) => m.get(field).cloned(),
            _ => None,
        }
    }

    /// Access an integer index into a Vec.
    pub fn get_index(&self, idx: i64) -> Option<&ScVal> {
        match self {
            Self::Vec(v) => {
                let i = usize::try_from(idx).ok()?;
                v.get(i)
            }
            _ => None,
        }
    }
}

/// Display: produces a human-readable string suitable for template output.
impl fmt::Display for ScVal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Bool(b)    => write!(f, "{}", b),
            Self::I32(n)     => write!(f, "{}", n),
            Self::U32(n)     => write!(f, "{}", n),
            Self::I64(n)     => write!(f, "{}", n),
            Self::U64(n)     => write!(f, "{}", n),
            Self::I128(n)    => write!(f, "{}", n),
            Self::U128(n)    => write!(f, "{}", n),
            Self::Address(s) => write!(f, "{}", s),
            Self::Symbol(s)  => write!(f, "{}", s),
            Self::Str(s)     => write!(f, "{}", s),
            Self::Bytes(b)   => write!(f, "0x{}", hex_encode(b)),
            Self::Void       => write!(f, ""),
            Self::Vec(v) => {
                write!(f, "[")?;
                for (i, item) in v.iter().enumerate() {
                    if i > 0 { write!(f, ", ")?; }
                    write!(f, "{}", item)?;
                }
                write!(f, "]")
            }
            Self::Map(m) => {
                write!(f, "{{")?;
                for (i, (k, v)) in m.iter().enumerate() {
                    if i > 0 { write!(f, ", ")?; }
                    write!(f, "{}: {}", k, v)?;
                }
                write!(f, "}}")
            }
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Shorten a Stellar StrKey address: keep first 4 + last 4 chars.
pub fn shorten_address(addr: &str) -> String {
    if addr.len() <= 10 {
        return addr.to_owned();
    }
    format!("{}…{}", &addr[..4], &addr[addr.len() - 4..])
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

// ── Conversion helpers ────────────────────────────────────────────────────────

impl From<bool>   for ScVal { fn from(v: bool)   -> Self { Self::Bool(v) } }
impl From<i32>    for ScVal { fn from(v: i32)    -> Self { Self::I32(v) } }
impl From<u32>    for ScVal { fn from(v: u32)    -> Self { Self::U32(v) } }
impl From<i64>    for ScVal { fn from(v: i64)    -> Self { Self::I64(v) } }
impl From<u64>    for ScVal { fn from(v: u64)    -> Self { Self::U64(v) } }
impl From<i128>   for ScVal { fn from(v: i128)   -> Self { Self::I128(v) } }
impl From<u128>   for ScVal { fn from(v: u128)   -> Self { Self::U128(v) } }
impl From<String> for ScVal { fn from(v: String) -> Self { Self::Str(v) } }
impl From<&str>   for ScVal { fn from(v: &str)   -> Self { Self::Str(v.to_owned()) } }
