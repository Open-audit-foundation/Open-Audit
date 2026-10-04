;; Adversarial: attempt to import WASI fd_write — must be rejected pre-instantiate.
(module
  (import "wasi_snapshot_preview1" "fd_write"
    (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (import "env" "memory" (memory 1))
  (func (export "alloc") (param i32) (result i32) (i32.const 16))
  (func (export "dealloc") (param i32 i32) nop)
  (func (export "get_output_len") (result i32) (i32.const 0))
  (func (export "translate") (param i32 i32) (result i32)
    (drop (call $fd_write (i32.const 1) (i32.const 0) (i32.const 0) (i32.const 0)))
    (i32.const 0)
  )
)
