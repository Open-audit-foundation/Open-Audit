;; Adversarial: grow memory until the host maximum is hit, then trap.
(module
  (import "env" "memory" (memory 1))
  (func (export "alloc") (param i32) (result i32) (i32.const 16))
  (func (export "dealloc") (param i32 i32) nop)
  (func (export "get_output_len") (result i32) (i32.const 0))
  (func (export "translate") (param i32 i32) (result i32)
    (loop $grow
      (if (i32.eq (memory.grow (i32.const 1)) (i32.const -1))
        (then (unreachable))
        (else (br $grow))
      )
    )
    (i32.const 0)
  )
)
