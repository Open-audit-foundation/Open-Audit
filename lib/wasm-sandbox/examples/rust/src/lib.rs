//! Example Open-Audit community parser (issue #405).
//!
//! Build:
//!   rustup target add wasm32-unknown-unknown
//!   cargo build --release --target wasm32-unknown-unknown
//!   cp target/wasm32-unknown-unknown/release/open_audit_community_parser.wasm ./parser.wasm
//!
//! ABI: import env.memory; export alloc, dealloc, translate, get_output_len.

#![allow(clippy::missing_safety_doc)]

use std::alloc::{alloc as sys_alloc, dealloc as sys_dealloc, Layout};
use std::slice;

static mut OUT_PTR: *mut u8 = std::ptr::null_mut();
static mut OUT_LEN: usize = 0;

#[no_mangle]
pub unsafe extern "C" fn alloc(size: usize) -> *mut u8 {
    if size == 0 {
        return std::ptr::null_mut();
    }
    let layout = Layout::from_size_align_unchecked(size, 1);
    sys_alloc(layout)
}

#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, size: usize) {
    if ptr.is_null() || size == 0 {
        return;
    }
    let layout = Layout::from_size_align_unchecked(size, 1);
    sys_dealloc(ptr, layout);
}

#[no_mangle]
pub extern "C" fn get_output_len() -> usize {
    unsafe { OUT_LEN }
}

/// Translate a WasmParserInput JSON blob into WasmParserOutput JSON.
///
/// This demo does not fully parse XDR; it emits a stable description so the
/// registry integration path can be verified end-to-end. Real parsers should
/// decode `topics` / `data` carefully inside these resource limits.
#[no_mangle]
pub unsafe extern "C" fn translate(in_ptr: *const u8, in_len: usize) -> *mut u8 {
    let input = if in_ptr.is_null() || in_len == 0 {
        ""
    } else {
        std::str::from_utf8(slice::from_raw_parts(in_ptr, in_len)).unwrap_or("")
    };

    let contract = extract_json_string(input, "contractId").unwrap_or("unknown");
    let short = if contract.len() > 8 {
        format!("{}…{}", &contract[..4], &contract[contract.len() - 4..])
    } else {
        contract.to_string()
    };

    let description = format!("Community parser: sample transfer on {short}");
    let out = format!(
        "{{\"description\":{},\"eventType\":\"transfer\"}}",
        json_escape(&description)
    );

    let bytes = out.as_bytes();
    let ptr = alloc(bytes.len());
    if ptr.is_null() {
        OUT_PTR = std::ptr::null_mut();
        OUT_LEN = 0;
        return std::ptr::null_mut();
    }
    std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
    OUT_PTR = ptr;
    OUT_LEN = bytes.len();
    ptr
}

fn json_escape(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            other => out.push(other),
        }
    }
    out.push('"');
    out
}

fn extract_json_string<'a>(json: &'a str, key: &str) -> Option<&'a str> {
    let pattern = format!("\"{key}\"");
    let idx = json.find(&pattern)?;
    let after_key = &json[idx + pattern.len()..];
    let colon = after_key.find(':')?;
    let mut rest = after_key[colon + 1..].trim_start();
    if !rest.starts_with('"') {
        return None;
    }
    rest = &rest[1..];
    let end = rest.find('"')?;
    Some(&rest[..end])
}
