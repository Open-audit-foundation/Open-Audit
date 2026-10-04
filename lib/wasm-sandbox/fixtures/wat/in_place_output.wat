;; Output aliases the input allocation. Freeing that allocation overwrites it.
;; Growing memory in dealloc proves cleanup still ran after output consumption.
(module
  (import "env" "memory" (memory 1 2))
  (data (i32.const 1024)
    "{\"description\":\"In-place parser output\",\"eventType\":\"transfer\"}")

  (func (export "alloc") (param $size i32) (result i32)
    (i32.const 64))

  (func (export "translate") (param $in_ptr i32) (param $in_len i32) (result i32)
    (memory.copy (local.get $in_ptr) (i32.const 1024) (i32.const 63))
    (local.get $in_ptr))

  (func (export "get_output_len") (result i32)
    (i32.const 63))

  (func (export "dealloc") (param $ptr i32) (param $size i32)
    (i32.store8 (local.get $ptr) (i32.const 0))
    (drop (memory.grow (i32.const 1))))
)
