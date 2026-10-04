;; Valid parser with a one-page maximum; growth must fail even with a higher host cap.
(module
  (import "env" "memory" (memory 1 1))
  (global $heap (mut i32) (i32.const 2048))
  (global $out_len (mut i32) (i32.const 0))

  (data (i32.const 64)
    "{\"description\":\"Community parser: sample transfer of 1.00 XLM\",\"eventType\":\"transfer\"}")

  (func $bump (param $size i32) (result i32)
    (local $ptr i32)
    (local.set $ptr (global.get $heap))
    (global.set $heap (i32.add (global.get $heap) (local.get $size)))
    (local.get $ptr)
  )

  (func (export "alloc") (param $size i32) (result i32)
    (call $bump (local.get $size))
  )

  (func (export "dealloc") (param $ptr i32) (param $size i32)
    nop
  )

  (func (export "get_output_len") (result i32)
    (global.get $out_len)
  )

  (func (export "translate") (param $in_ptr i32) (param $in_len i32) (result i32)
    (local $out i32)
    (local $len i32)
    (if (i32.ne (memory.grow (i32.const 1)) (i32.const -1))
      (then unreachable)
    )
    (local.set $len (i32.const 86))
    (local.set $out (call $bump (local.get $len)))
    (memory.copy (local.get $out) (i32.const 64) (local.get $len))
    (global.set $out_len (local.get $len))
    (local.get $out)
  )
)
