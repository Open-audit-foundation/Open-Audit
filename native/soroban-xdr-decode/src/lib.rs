//! soroban-xdr-decode — Native N-API addon for Stellar Soroban XDR decoding.
//!
//! # Exported Node.js functions
//!
//! | Function          | Signature                            | Description                                      |
//! |-------------------|--------------------------------------|--------------------------------------------------|
//! | `decodeScVal`     | `(input: string) => object`          | Decode a single ScVal (hex or base64).           |
//! | `decodeTopics`    | `(inputs: string[]) => object[]`     | Decode an ordered topic vector; fail-fast.       |
//! | `batchDecode`     | `(inputs: string[]) => object[]`     | Decode a batch; per-entry errors, no abort.      |
//! | `xdrSchemaVersion`| `() => string`                       | Schema generation (`"curr"`).                    |
//!
//! # Memory model
//!
//! Input strings arrive from V8 as UTF-8 slices owned by V8's heap.  The
//! `napi` crate exposes them as `&str` / `String` (one copy on the Rust side
//! during hex/base64 decode).  The decoded JSON value is serialised back to a
//! V8 object by napi-rs's `serde-json` feature, which writes directly into the
//! V8 object graph — no intermediate `JsObject` or `JsString` heap churn.
//!
//! For raw byte buffers (e.g. `ScVal::Bytes`), we hex-encode the slice before
//! handing it to serde_json, which avoids any V8 `ArrayBuffer` lifetime issue.
//!
//! # Error handling
//!
//! * `decodeScVal` / `decodeTopics` surface errors as a JavaScript `Error`
//!   (via `napi::Error`) — the event loop continues normally.
//! * `batchDecode` captures per-entry errors as `{ type: "Error", value: "…" }`
//!   objects, so a single malformed payload never aborts a bulk operation.

#![deny(clippy::unwrap_used)]
#![deny(clippy::panic)]

use napi_derive::napi;
use stellar_xdr::curr::{Limits, ReadXdr, ScAddress, ScMapEntry, ScVal};

// ── Input classification ──────────────────────────────────────────────────────

/// Classifies a caller-supplied string as either hex or base64 XDR.
enum InputKind<'a> {
    Hex(&'a str),
    Base64(&'a str),
}

impl<'a> InputKind<'a> {
    /// Heuristic: if the string starts with `0x`/`0X` it is hex.
    /// Otherwise look for at least one base64-only character (`+`, `/`, `=`);
    /// if found treat it as base64, else fall back to hex.
    fn classify(s: &'a str) -> Self {
        let t = s.trim();
        if t.starts_with("0x") || t.starts_with("0X") {
            return Self::Hex(&t[2..]);
        }
        let has_base64_char = t
            .chars()
            .any(|c| c == '+' || c == '/' || c == '=');
        if has_base64_char {
            Self::Base64(t)
        } else {
            Self::Hex(t)
        }
    }

    /// Decode to owned bytes.  Returns a descriptive error string on failure.
    fn decode(self) -> Result<Vec<u8>, String> {
        match self {
            Self::Hex(h) => {
                hex::decode(h).map_err(|e| format!("hex decode error: {e}"))
            }
            Self::Base64(b) => {
                use base64::Engine as _;
                base64::engine::general_purpose::STANDARD
                    .decode(b)
                    .map_err(|e| format!("base64 decode error: {e}"))
            }
        }
    }
}

// ── ScVal → serde_json::Value ─────────────────────────────────────────────────

/// Recursively map a `stellar_xdr::curr::ScVal` to a plain JSON value.
///
/// Each variant is wrapped in `{ "type": "<TypeName>", "value": … }` so that
/// the JavaScript consumer can discriminate on type without additional parsing.
///
/// Design notes:
/// - Numeric types wider than 53 bits are returned as *strings* to avoid
///   JavaScript's `Number.MAX_SAFE_INTEGER` precision cliff.
/// - Raw byte sequences are hex-encoded strings (compact, unambiguous).
/// - Container types (Map, Vec) recurse into this same function.
fn sc_val_to_json(val: &ScVal) -> serde_json::Value {
    use serde_json::{json, Value};
    use stellar_xdr::curr::ScVal as V;

    match val {
        // ── Boolean / Void ────────────────────────────────────────────────────
        V::Bool(b) => json!({ "type": "Bool",  "value": b }),
        V::Void    => json!({ "type": "Void",  "value": null }),

        // ── Error ─────────────────────────────────────────────────────────────
        V::Error(e) => json!({ "type": "Error", "value": format!("{e:?}") }),

        // ── 32-bit integers (safe in JSON Number) ─────────────────────────────
        V::U32(n) => json!({ "type": "U32", "value": n }),
        V::I32(n) => json!({ "type": "I32", "value": n }),

        // ── 64-bit integers: serialise as strings ─────────────────────────────
        V::U64(n) => json!({ "type": "U64", "value": n.to_string() }),
        V::I64(n) => json!({ "type": "I64", "value": n.to_string() }),

        // ── Ledger timestamps (u64 seconds) ───────────────────────────────────
        V::Timepoint(t) => json!({ "type": "Timepoint", "value": t.0.to_string() }),
        V::Duration(d)  => json!({ "type": "Duration",  "value": d.0.to_string() }),

        // ── 128-bit integers: serialise as strings ────────────────────────────
        V::U128(parts) => json!({
            "type":  "U128",
            "value": u128_to_string(parts.hi, parts.lo),
        }),
        V::I128(parts) => json!({
            "type":  "I128",
            "value": i128_to_string(parts.hi as i64, parts.lo),
        }),

        // ── 256-bit integers: four u64 limbs as strings ───────────────────────
        V::U256(parts) => json!({
            "type":  "U256",
            "hi_hi": parts.hi_hi.to_string(),
            "hi_lo": parts.hi_lo.to_string(),
            "lo_hi": parts.lo_hi.to_string(),
            "lo_lo": parts.lo_lo.to_string(),
        }),
        V::I256(parts) => json!({
            "type":  "I256",
            "hi_hi": (parts.hi_hi as i64).to_string(),
            "hi_lo": parts.hi_lo.to_string(),
            "lo_hi": parts.lo_hi.to_string(),
            "lo_lo": parts.lo_lo.to_string(),
        }),

        // ── Byte buffer: hex-encode so JSON carries it safely ─────────────────
        V::Bytes(b) => json!({
            "type":  "Bytes",
            "value": hex::encode(b.as_slice()),
            "len":   b.len(),
        }),

        // ── Text types ────────────────────────────────────────────────────────
        V::String(s) => json!({
            "type":  "String",
            "value": s.to_utf8_string_lossy(),
        }),
        V::Symbol(sym) => json!({
            "type":  "Symbol",
            "value": sym.to_string(),
        }),

        // ── Address: G... (account) or C... (contract) ────────────────────────
        V::Address(addr) => json!({
            "type":  "Address",
            "value": sc_address_to_string(addr),
        }),

        // ── Ledger-key sentinels ──────────────────────────────────────────────
        V::LedgerKeyContractInstance => {
            json!({ "type": "LedgerKeyContractInstance" })
        }
        V::LedgerKeyNonce(n) => json!({
            "type":  "LedgerKeyNonce",
            "nonce": n.nonce.to_string(),
        }),

        // ── Vec: recurse ──────────────────────────────────────────────────────
        V::Vec(Some(items)) => {
            let arr: Vec<Value> = items.iter().map(sc_val_to_json).collect();
            json!({ "type": "Vec", "value": arr })
        }
        V::Vec(None) => json!({ "type": "Vec", "value": [] }),

        // ── Map: array of {key, value} pairs ──────────────────────────────────
        V::Map(Some(entries)) => {
            let pairs: Vec<Value> = entries
                .iter()
                .map(|ScMapEntry { key, val }| json!({
                    "key":   sc_val_to_json(key),
                    "value": sc_val_to_json(val),
                }))
                .collect();
            json!({ "type": "Map", "value": pairs })
        }
        V::Map(None) => json!({ "type": "Map", "value": [] }),

        // ── ContractInstance: executable kind + optional storage ──────────────
        V::ContractInstance(inst) => {
            let mut obj = serde_json::Map::new();
            obj.insert("type".into(), "ContractInstance".into());
            obj.insert(
                "executable".into(),
                Value::String(format!("{:?}", inst.executable)),
            );
            if let Some(storage) = &inst.storage {
                let pairs: Vec<Value> = storage
                    .iter()
                    .map(|ScMapEntry { key, val }| json!({
                        "key":   sc_val_to_json(key),
                        "value": sc_val_to_json(val),
                    }))
                    .collect();
                obj.insert("storage".into(), Value::Array(pairs));
            }
            Value::Object(obj)
        }
    }
}

// ── Address helpers ───────────────────────────────────────────────────────────

/// Encode a `ScAddress` to its canonical Stellar StrKey representation:
/// - Account IDs → `G…` (56-char base32)
/// - Contract IDs → `C…` (56-char base32)
fn sc_address_to_string(addr: &ScAddress) -> String {
    use stellar_xdr::curr::PublicKey::PublicKeyTypeEd25519;
    match addr {
        ScAddress::Account(account_id) => match &account_id.0 {
            PublicKeyTypeEd25519(key) => {
                stellar_strkey::ed25519::PublicKey(key.0).to_string()
            }
        },
        ScAddress::Contract(hash) => {
            stellar_strkey::Contract(hash.0).to_string()
        }
    }
}

// ── 128-bit / 256-bit helpers ─────────────────────────────────────────────────

fn u128_to_string(hi: u64, lo: u64) -> String {
    (((hi as u128) << 64) | (lo as u128)).to_string()
}

fn i128_to_string(hi: i64, lo: u64) -> String {
    (((hi as i128) << 64) | (lo as i128)).to_string()
}

// ── Core decode (shared by all exports) ──────────────────────────────────────

/// Decode a single XDR-encoded `ScVal` string (hex or base64) into a
/// `serde_json::Value`.  Returns `Err(String)` on any failure.
fn decode_inner(input: &str) -> std::result::Result<serde_json::Value, String> {
    let bytes = InputKind::classify(input).decode()?;

    // stellar-xdr uses a `Limited` reader to enforce recursion / size limits.
    // `Limits::none()` applies no hard caps here; the calling layer (Node.js)
    // is expected to gate payload size at the HTTP / WebSocket boundary.
    let sc_val = ScVal::read_xdr(&mut stellar_xdr::curr::Limited::new(
        std::io::Cursor::new(bytes.as_slice()),
        Limits::none(),
    ))
    .map_err(|e| format!("XDR parse error: {e}"))?;

    Ok(sc_val_to_json(&sc_val))
}

// ── Exported N-API functions ──────────────────────────────────────────────────

/// Decode a single Soroban `ScVal` from a hex or base64 XDR string.
///
/// Throws a JavaScript `Error` (with a descriptive message) on malformed input.
/// The Node.js event loop is **never** crashed by this function.
///
/// ```js
/// const native = require('./index.node');
///
/// // base64 — true zero for ScVal::Void
/// native.decodeScVal('AAAAAA==');
/// // → { type: 'Void', value: null }
///
/// // hex — Symbol("transfer")
/// native.decodeScVal('0000000e00000008' + '7472616e73666572');
/// // → { type: 'Symbol', value: 'transfer' }
/// ```
#[napi]
pub fn decode_sc_val(input: String) -> napi::Result<serde_json::Value> {
    decode_inner(&input)
        .map_err(|msg| napi::Error::new(napi::Status::InvalidArg, msg))
}

/// Decode an ordered vector of Soroban topic `ScVal` strings (as returned by
/// the Soroban RPC `events` endpoint in the `topic` / `topics` field).
///
/// Fails fast: if **any** entry is malformed the call throws a `JavaScript
/// Error` identifying the index, e.g. `"topic[1]: hex decode error: …"`.
///
/// ```js
/// const native = require('./index.node');
/// const topics = native.decodeTopics(['AAAAAA==', 'AAAAB...']);
/// // → [{ type: 'Void', value: null }, { type: 'Symbol', value: 'transfer' }]
/// ```
#[napi]
pub fn decode_topics(inputs: Vec<String>) -> napi::Result<Vec<serde_json::Value>> {
    inputs
        .iter()
        .enumerate()
        .map(|(i, s)| {
            decode_inner(s).map_err(|msg| {
                napi::Error::new(
                    napi::Status::InvalidArg,
                    format!("topic[{i}]: {msg}"),
                )
            })
        })
        .collect()
}

/// Decode a batch of `ScVal` strings, tolerating per-entry failures.
///
/// Unlike `decodeTopics`, a malformed entry does **not** throw — instead it
/// produces `{ type: "Error", value: "<error message>" }` at that index.
/// This ensures a single bad payload never aborts a bulk ingestion pipeline.
///
/// ```js
/// const native = require('./index.node');
/// const results = native.batchDecode(['AAAAAA==', 'not-valid-xdr', 'AAAAB...']);
/// // results[1] → { type: 'Error', value: 'hex decode error: …' }
/// ```
#[napi]
pub fn batch_decode(inputs: Vec<String>) -> Vec<serde_json::Value> {
    inputs
        .iter()
        .map(|s| match decode_inner(s) {
            Ok(v) => v,
            Err(msg) => serde_json::json!({ "type": "Error", "value": msg }),
        })
        .collect()
}

/// Return the XDR schema generation this addon was compiled against (`"curr"`).
/// Useful for runtime compatibility assertions.
///
/// ```js
/// const native = require('./index.node');
/// console.assert(native.xdrSchemaVersion() === 'curr');
/// ```
#[napi]
pub fn xdr_schema_version() -> &'static str {
    "curr"
}
