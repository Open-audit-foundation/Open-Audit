;; Adversarial: attempt to import a Node-style fs API — must be rejected.
(module
  (import "fs" "readFileSync" (func $read (param i32 i32) (result i32)))
  (import "env" "memory" (memory 1))
  (func (export "alloc") (param i32) (result i32) (i32.const 16))
  (func (export "dealloc") (param i32 i32) nop)
  (func (export "get_output_len") (result i32) (i32.const 0))
  (func (export "translate") (param i32 i32) (result i32)
    (drop (call $read (i32.const 0) (i32.const 0)))
    (i32.const 0)
  )
)
