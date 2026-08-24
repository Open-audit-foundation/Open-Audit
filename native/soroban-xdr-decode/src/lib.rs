//! Native Soroban ScVal XDR decoder.
//!
//! This crate mirrors, byte for byte, the observable behavior of
//! `lib/translator/secure-xdr-parser.ts` (`secureParseScVal`):
//!
//! 1. `validateHexLength` — reject hex strings longer than MAX_HEX_STRING_LENGTH
//! 2. `trackAllocation(hexLen / 2)` — pre-parse allocation accounting
//! 3. Node-compatible hex decoding (`Buffer.from(hex, "hex")` semantics:
//!    case-insensitive, stops silently at the first invalid pair)
//! 4. Full protocol-21 ScVal XDR parse with the same acceptance rules as
//!    @stellar/js-xdr (padding must be zero, bool/option flags must be 0/1,
//!    enum members validated, entire input must be consumed)
//! 5. A validation traversal replicating `validateScValStructure` exactly:
//!    same guard order, same per-node allocation estimates, same
//!    path-scoped (copy-on-write) context semantics.
//!
//! The guard limits are ports of `lib/translator/parser-security.ts` and must
//! never be relaxed relative to the TypeScript implementation.

#[macro_use]
extern crate napi_derive;

use std::time::Instant;

// Ports of the constants in lib/translator/parser-security.ts.
const MAX_RECURSION_DEPTH: u32 = 100;
const MAX_PAYLOAD_SIZE_BYTES: f64 = 10.0 * 1024.0 * 1024.0;
const MAX_PARSE_TIME_MS: f64 = 5000.0;
const MAX_HEX_STRING_LENGTH: usize = 2 * 1024 * 1024 * 2;
const MAX_COLLECTION_SIZE: usize = 10_000;

// Pure safety net for the parse phase (not a TS guard): payloads nested deeper
// than this are rejected as malformed instead of risking a native stack
// overflow. The TS implementation would hit the JS engine's own call-stack
// limit in the same territory, which it also reports as MALFORMED_XDR.
const PARSE_STACK_SAFETY_LIMIT: u32 = 2000;

const SCSYMBOL_LIMIT: u32 = 32;

enum Guard {
    Depth { depth: u32 },
    Payload { size: f64 },
    ParseTime { elapsed: f64 },
    Collection { size: usize },
    HexLength { len: usize },
    Malformed(String),
}

/// Result shape handed back to the TypeScript wrapper. On failure the wrapper
/// reconstructs the exact ParserSecurityError subclass from `errorType`,
/// `actual` and `limit`, so the error messages match the TS path verbatim.
#[napi(object)]
pub struct DecodeOutcome {
    pub success: bool,
    pub error_type: Option<String>,
    /// The offending value (depth reached, bytes allocated, ...) for guard errors.
    pub actual: Option<f64>,
    /// The limit that was exceeded, for guard errors.
    pub limit: Option<f64>,
    /// Underlying parse error detail for MALFORMED_XDR.
    pub message: Option<String>,
}

#[napi]
pub fn decode_sc_val(hex: String) -> DecodeOutcome {
    let start = Instant::now();
    match run(&hex, start) {
        Ok(()) => DecodeOutcome {
            success: true,
            error_type: None,
            actual: None,
            limit: None,
            message: None,
        },
        Err(guard) => {
            let (error_type, actual, limit, message) = match guard {
                Guard::Depth { depth } => (
                    "MAX_DEPTH_EXCEEDED",
                    Some(depth as f64),
                    Some(MAX_RECURSION_DEPTH as f64),
                    None,
                ),
                Guard::Payload { size } => (
                    "MAX_PAYLOAD_SIZE_EXCEEDED",
                    Some(size),
                    Some(MAX_PAYLOAD_SIZE_BYTES),
                    None,
                ),
                Guard::ParseTime { elapsed } => (
                    "MAX_PARSE_TIME_EXCEEDED",
                    Some(elapsed),
                    Some(MAX_PARSE_TIME_MS),
                    None,
                ),
                Guard::Collection { size } => (
                    "MAX_COLLECTION_SIZE_EXCEEDED",
                    Some(size as f64),
                    Some(MAX_COLLECTION_SIZE as f64),
                    None,
                ),
                Guard::HexLength { len } => (
                    "MAX_HEX_LENGTH_EXCEEDED",
                    Some(len as f64),
                    Some(MAX_HEX_STRING_LENGTH as f64),
                    None,
                ),
                Guard::Malformed(msg) => ("MALFORMED_XDR", None, None, Some(msg)),
            };
            DecodeOutcome {
                success: false,
                error_type: Some(error_type.to_string()),
                actual,
                limit,
                message,
            }
        }
    }
}

fn run(hex: &str, start: Instant) -> Result<(), Guard> {
    // safeParseXdr checks the timeout before doing anything else.
    check_timeout(start)?;

    let clean = hex.strip_prefix("0x").unwrap_or(hex);

    // validateHexLength — JS string .length counts UTF-16 code units.
    let hex_len = if clean.is_ascii() {
        clean.len()
    } else {
        clean.encode_utf16().count()
    };
    if hex_len > MAX_HEX_STRING_LENGTH {
        return Err(Guard::HexLength { len: hex_len });
    }

    // trackAllocation(ctx, cleanHex.length / 2) — note: counts the raw string
    // length, not the decoded byte count, and may be fractional.
    let allocated = hex_len as f64 / 2.0;
    if allocated > MAX_PAYLOAD_SIZE_BYTES {
        return Err(Guard::Payload { size: allocated });
    }

    let bytes = node_hex_decode(clean);

    let node = {
        let mut r = Reader::new(&bytes);
        let node = parse_scval(&mut r, 0)?;
        r.ensure_consumed()?;
        node
    };

    validate(
        &node,
        Ctx {
            depth: 0,
            allocated,
        },
        start,
    )?;

    Ok(())
}

/// Node `Buffer.from(str, "hex")` semantics: decode two-character pairs,
/// case-insensitively, stopping silently at the first pair containing an
/// invalid character (a trailing odd character is dropped).
fn node_hex_decode(s: &str) -> Vec<u8> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len() / 2);
    let mut i = 0;
    while i + 1 < b.len() {
        let hi = hex_val(b[i]);
        let lo = hex_val(b[i + 1]);
        match (hi, lo) {
            (Some(h), Some(l)) => out.push((h << 4) | l),
            _ => break,
        }
        i += 2;
    }
    out
}

fn hex_val(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

// ============================================================================
// XDR parse phase (protocol 21 ScVal grammar, @stellar/js-xdr acceptance rules)
// ============================================================================

/// Only the information the validation traversal needs is retained; every
/// other variant still gets fully parsed (and rejected when malformed) but
/// collapses to `Other`, exactly like the `default` branch in
/// `validateScValStructure`.
enum Node {
    Map(Vec<(Node, Node)>),
    Vec(Vec<Node>),
    Bytes(usize),
    /// UTF-8-lossy byte length, matching Buffer.byteLength(buf.toString("utf8")).
    Str(usize),
    Other,
}

struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Reader { data, pos: 0 }
    }

    fn take(&mut self, n: usize) -> Result<&'a [u8], Guard> {
        if n > self.data.len() - self.pos {
            return Err(Guard::Malformed(format!(
                "attempt to read outside the boundary of the buffer (pos {}, want {}, len {})",
                self.pos,
                n,
                self.data.len()
            )));
        }
        let s = &self.data[self.pos..self.pos + n];
        self.pos += n;
        Ok(s)
    }

    fn read_i32(&mut self) -> Result<i32, Guard> {
        let b = self.take(4)?;
        Ok(i32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn read_u32(&mut self) -> Result<u32, Guard> {
        let b = self.take(4)?;
        Ok(u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn skip(&mut self, n: usize) -> Result<(), Guard> {
        self.take(n).map(|_| ())
    }

    /// Reads XDR variable-length opaque/string data: 4-byte length, payload,
    /// and zero padding to a 4-byte boundary (js-xdr rejects nonzero padding).
    fn read_var_opaque(&mut self, limit: u32) -> Result<&'a [u8], Guard> {
        let len = self.read_u32()?;
        if len > limit {
            return Err(Guard::Malformed(format!(
                "saw {} length, but maximum allowed is {}",
                len, limit
            )));
        }
        let data = self.take(len as usize)?;
        let pad = (4 - (len as usize % 4)) % 4;
        let padding = self.take(pad)?;
        if padding.iter().any(|&b| b != 0) {
            return Err(Guard::Malformed("invalid padding".to_string()));
        }
        Ok(data)
    }

    /// js-xdr bools (and option flags) must be exactly 0 or 1.
    fn read_bool(&mut self) -> Result<bool, Guard> {
        match self.read_i32()? {
            0 => Ok(false),
            1 => Ok(true),
            v => Err(Guard::Malformed(format!(
                "got {} when trying to read a bool",
                v
            ))),
        }
    }

    fn ensure_consumed(&self) -> Result<(), Guard> {
        if self.pos < self.data.len() {
            return Err(Guard::Malformed(format!(
                "invalid XDR contract, {} bytes were not consumed",
                self.data.len() - self.pos
            )));
        }
        Ok(())
    }
}

fn parse_scval(r: &mut Reader, depth: u32) -> Result<Node, Guard> {
    if depth > PARSE_STACK_SAFETY_LIMIT {
        return Err(Guard::Malformed(
            "maximum parse nesting exceeded".to_string(),
        ));
    }

    let disc = r.read_i32()?;
    match disc {
        // SCV_BOOL
        0 => {
            r.read_bool()?;
            Ok(Node::Other)
        }
        // SCV_VOID
        1 => Ok(Node::Other),
        // SCV_ERROR
        2 => {
            parse_sc_error(r)?;
            Ok(Node::Other)
        }
        // SCV_U32 / SCV_I32
        3 | 4 => {
            r.skip(4)?;
            Ok(Node::Other)
        }
        // SCV_U64 / SCV_I64 / SCV_TIMEPOINT / SCV_DURATION
        5..=8 => {
            r.skip(8)?;
            Ok(Node::Other)
        }
        // SCV_U128 / SCV_I128
        9 | 10 => {
            r.skip(16)?;
            Ok(Node::Other)
        }
        // SCV_U256 / SCV_I256
        11 | 12 => {
            r.skip(32)?;
            Ok(Node::Other)
        }
        // SCV_BYTES
        13 => {
            let data = r.read_var_opaque(u32::MAX)?;
            Ok(Node::Bytes(data.len()))
        }
        // SCV_STRING
        14 => {
            let data = r.read_var_opaque(u32::MAX)?;
            Ok(Node::Str(String::from_utf8_lossy(data).len()))
        }
        // SCV_SYMBOL
        15 => {
            r.read_var_opaque(SCSYMBOL_LIMIT)?;
            Ok(Node::Other)
        }
        // SCV_VEC (optional SCVec)
        16 => {
            if r.read_bool()? {
                let count = read_var_array_len(r)?;
                let mut items = Vec::with_capacity(count.min(remaining_capacity(r)));
                for _ in 0..count {
                    items.push(parse_scval(r, depth + 1)?);
                }
                Ok(Node::Vec(items))
            } else {
                // scVal.vec() ?? [] — a null vec validates like an empty one.
                Ok(Node::Vec(Vec::new()))
            }
        }
        // SCV_MAP (optional SCMap)
        17 => {
            if r.read_bool()? {
                let entries = parse_sc_map(r, depth)?;
                Ok(Node::Map(entries))
            } else {
                Ok(Node::Map(Vec::new()))
            }
        }
        // SCV_ADDRESS
        18 => {
            parse_sc_address(r)?;
            Ok(Node::Other)
        }
        // SCV_CONTRACT_INSTANCE — parsed fully, but the TS validator treats it
        // as a primitive (default branch), so it collapses to Other.
        19 => {
            match r.read_i32()? {
                0 => r.skip(32)?, // CONTRACT_EXECUTABLE_WASM: Hash
                1 => {}           // CONTRACT_EXECUTABLE_STELLAR_ASSET: void
                v => {
                    return Err(Guard::Malformed(format!(
                        "unknown ContractExecutable member for value {}",
                        v
                    )))
                }
            }
            if r.read_bool()? {
                parse_sc_map(r, depth)?;
            }
            Ok(Node::Other)
        }
        // SCV_LEDGER_KEY_CONTRACT_INSTANCE
        20 => Ok(Node::Other),
        // SCV_LEDGER_KEY_NONCE — ScNonceKey { int64 nonce }
        21 => {
            r.skip(8)?;
            Ok(Node::Other)
        }
        v => Err(Guard::Malformed(format!(
            "unknown ScValType member for value {}",
            v
        ))),
    }
}

/// SCVec and SCMap are declared with a 2147483647 max length; js-xdr rejects
/// larger claimed counts before reading any element.
fn read_var_array_len(r: &mut Reader) -> Result<usize, Guard> {
    let count = r.read_u32()?;
    if count > 2_147_483_647 {
        return Err(Guard::Malformed(format!(
            "saw {} length VarArray, max allowed is 2147483647",
            count
        )));
    }
    Ok(count as usize)
}

fn parse_sc_map(r: &mut Reader, depth: u32) -> Result<Vec<(Node, Node)>, Guard> {
    let count = read_var_array_len(r)?;
    let mut entries = Vec::with_capacity(count.min(remaining_capacity(r)));
    for _ in 0..count {
        let key = parse_scval(r, depth + 1)?;
        let val = parse_scval(r, depth + 1)?;
        entries.push((key, val));
    }
    Ok(entries)
}

fn parse_sc_error(r: &mut Reader) -> Result<(), Guard> {
    let error_type = r.read_i32()?;
    match error_type {
        // SCE_CONTRACT: uint32 contractCode
        0 => r.skip(4),
        // SCE_WASM_VM..SCE_AUTH: SCErrorCode (enum, members 0..=9) — in the
        // protocol-21 defs stellar-sdk 12 ships, every non-contract arm
        // carries a code.
        1..=9 => {
            let code = r.read_i32()?;
            if !(0..=9).contains(&code) {
                return Err(Guard::Malformed(format!(
                    "unknown ScErrorCode member for value {}",
                    code
                )));
            }
            Ok(())
        }
        v => Err(Guard::Malformed(format!(
            "unknown ScErrorType member for value {}",
            v
        ))),
    }
}

fn parse_sc_address(r: &mut Reader) -> Result<(), Guard> {
    match r.read_i32()? {
        // SC_ADDRESS_TYPE_ACCOUNT: AccountID = PublicKey
        0 => match r.read_i32()? {
            // PUBLIC_KEY_TYPE_ED25519: uint256
            0 => r.skip(32),
            v => Err(Guard::Malformed(format!(
                "unknown PublicKeyType member for value {}",
                v
            ))),
        },
        // SC_ADDRESS_TYPE_CONTRACT: Hash
        1 => r.skip(32),
        v => Err(Guard::Malformed(format!(
            "unknown ScAddressType member for value {}",
            v
        ))),
    }
}

/// Caps Vec::with_capacity so a payload claiming a huge element count cannot
/// force a large up-front allocation (each element needs at least 4 bytes).
fn remaining_capacity(r: &Reader) -> usize {
    (r.data.len() - r.pos) / 4 + 1
}

// ============================================================================
// Validation phase — exact port of validateScValStructure
// ============================================================================

/// Mirror of the TS ParsingContext where it matters. The TS code copies the
/// context on every trackAllocation/enterLevel, so allocation accumulates
/// along a root-to-leaf path, not globally — Copy semantics replicate that.
#[derive(Clone, Copy)]
struct Ctx {
    depth: u32,
    allocated: f64,
}

fn check_timeout(start: Instant) -> Result<(), Guard> {
    let elapsed = start.elapsed().as_millis() as f64;
    if elapsed > MAX_PARSE_TIME_MS {
        return Err(Guard::ParseTime { elapsed });
    }
    Ok(())
}

fn track_allocation(ctx: Ctx, bytes: f64) -> Result<Ctx, Guard> {
    let new_total = ctx.allocated + bytes;
    if new_total > MAX_PAYLOAD_SIZE_BYTES {
        return Err(Guard::Payload { size: new_total });
    }
    Ok(Ctx {
        depth: ctx.depth,
        allocated: new_total,
    })
}

fn enter_level(ctx: Ctx) -> Result<Ctx, Guard> {
    let new_depth = ctx.depth + 1;
    if new_depth > MAX_RECURSION_DEPTH {
        return Err(Guard::Depth { depth: new_depth });
    }
    Ok(Ctx {
        depth: new_depth,
        allocated: ctx.allocated,
    })
}

fn validate_collection_size(size: usize) -> Result<(), Guard> {
    if size > MAX_COLLECTION_SIZE {
        return Err(Guard::Collection { size });
    }
    Ok(())
}

fn validate(node: &Node, ctx: Ctx, start: Instant) -> Result<(), Guard> {
    check_timeout(start)?;

    match node {
        Node::Map(entries) => {
            validate_collection_size(entries.len())?;
            let ctx = track_allocation(ctx, entries.len() as f64 * 100.0)?;
            let child = enter_level(ctx)?;
            for (key, val) in entries {
                validate(key, child, start)?;
                validate(val, child, start)?;
            }
        }
        Node::Vec(items) => {
            validate_collection_size(items.len())?;
            let ctx = track_allocation(ctx, items.len() as f64 * 50.0)?;
            let child = enter_level(ctx)?;
            for item in items {
                validate(item, child, start)?;
            }
        }
        Node::Bytes(len) => {
            track_allocation(ctx, *len as f64)?;
        }
        Node::Str(len) => {
            track_allocation(ctx, *len as f64)?;
        }
        Node::Other => {
            track_allocation(ctx, 8.0)?;
        }
    }
    Ok(())
}
