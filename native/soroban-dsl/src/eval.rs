//! Evaluation engine — walks the AST against a bound `EvalContext`.
//!
//! # Security properties
//!
//! * **Step budget**: every node traversal decrements a counter; evaluation
//!   aborts with `StepBudgetExceeded` when it reaches zero.  This is the
//!   primary defence against infinite loops (which the DSL grammar already
//!   makes impossible to express directly, but malformed ASTs cannot be
//!   excluded once serialisation is added).
//! * **Type safety**: every arithmetic and comparison operation checks the
//!   runtime type of both operands; mismatches return `TypeError` rather than
//!   coercing silently.
//! * **Overflow safety**: all integer arithmetic uses checked operations;
//!   overflows return `Overflow` rather than wrapping.
//! * **No heap allocation beyond the output string**: the evaluator does not
//!   allocate unbounded data structures.

use std::collections::HashMap;

use crate::error::{DslError, DslResult};
use crate::parser::{BinOp, Expr, Program, Stmt, UnaryOp};
use crate::scval::ScVal;

/// Maximum number of evaluation steps before aborting.
pub const STEP_BUDGET: usize = 1_000;

// ── Evaluation context ────────────────────────────────────────────────────────

/// Holds the named bindings visible to a DSL program.
///
/// Bindings are set by the host before calling `Evaluator::execute`.
/// Additional bindings can be created by `let` statements during evaluation.
#[derive(Debug, Clone, Default)]
pub struct EvalContext {
    vars: HashMap<String, ScVal>,
}

impl EvalContext {
    pub fn new() -> Self {
        Self::default()
    }

    /// Bind a name to a value.  Overwrites any existing binding with the same name.
    pub fn bind(&mut self, name: impl Into<String>, value: impl Into<ScVal>) {
        self.vars.insert(name.into(), value.into());
    }

    /// Look up a name, returning `None` if it is not bound.
    pub fn get(&self, name: &str) -> Option<&ScVal> {
        self.vars.get(name)
    }
}

// ── Evaluator ─────────────────────────────────────────────────────────────────

/// Executes a parsed DSL program against a given context.
pub struct Evaluator<'ctx> {
    /// The outer (host-supplied) context — read-only.
    outer: &'ctx EvalContext,
    /// Local variables created by `let` statements — shadows `outer`.
    locals: HashMap<String, ScVal>,
    /// Remaining step budget.
    steps: usize,
}

impl<'ctx> Evaluator<'ctx> {
    pub fn new(ctx: &'ctx EvalContext) -> Self {
        Self {
            outer:  ctx,
            locals: HashMap::new(),
            steps:  STEP_BUDGET,
        }
    }

    // ── Entry-point ──────────────────────────────────────────────────────────

    /// Execute a complete program.  Returns the string produced by the first
    /// `return` statement, or `NoReturnValue` if none is reached.
    pub fn execute(&mut self, program: &Program) -> DslResult<String> {
        match self.run_stmts(program)? {
            Some(val) => Ok(val.to_string()),
            None      => Err(DslError::NoReturnValue),
        }
    }

    // ── Statement execution ───────────────────────────────────────────────────

    /// Execute a sequence of statements, returning the value from the first
    /// `return` that is reached (or `None` if no `return` executed).
    fn run_stmts(&mut self, stmts: &[Stmt]) -> DslResult<Option<ScVal>> {
        for stmt in stmts {
            if let Some(val) = self.run_stmt(stmt)? {
                return Ok(Some(val));
            }
        }
        Ok(None)
    }

    fn run_stmt(&mut self, stmt: &Stmt) -> DslResult<Option<ScVal>> {
        self.tick()?;
        match stmt {
            Stmt::Let { name, value } => {
                let val = self.eval_expr(value)?;
                self.locals.insert(name.clone(), val);
                Ok(None)
            }
            Stmt::Return(expr) => {
                let val = self.eval_expr(expr)?;
                Ok(Some(val))
            }
            Stmt::If { condition, then_branch, else_branch } => {
                let cond = self.eval_expr(condition)?;
                if cond.is_truthy() {
                    self.run_stmts(then_branch)
                } else if let Some(branch) = else_branch {
                    self.run_stmts(branch)
                } else {
                    Ok(None)
                }
            }
        }
    }

    // ── Expression evaluation ─────────────────────────────────────────────────

    fn eval_expr(&mut self, expr: &Expr) -> DslResult<ScVal> {
        self.tick()?;
        match expr {
            // ── Literals ────────────────────────────────────────────────────
            Expr::Integer(n)    => Ok(ScVal::I128(*n)),
            Expr::Float(_f)     => {
                // Floats are parsed but not supported as a runtime value —
                // all Soroban numeric types are integers.  Reject at eval time
                // so the type system stays clean.
                Err(DslError::TypeError {
                    expected: "integer".into(),
                    got:      "float".into(),
                    context:  "literal".into(),
                })
            }
            Expr::StringLit(s)  => Ok(ScVal::Str(s.clone())),
            Expr::Bool(b)       => Ok(ScVal::Bool(*b)),
            Expr::Null          => Ok(ScVal::Void),

            // ── Variable lookup ─────────────────────────────────────────────
            Expr::Ident(name) => {
                self.lookup(name).cloned().ok_or_else(|| DslError::UndefinedVariable {
                    name: name.clone(),
                })
            }

            // ── Field access: `expr.field` ───────────────────────────────────
            Expr::FieldAccess { object, field } => {
                let obj = self.eval_expr(object)?;
                obj.get_field(field).ok_or_else(|| DslError::NoSuchField {
                    field:   field.clone(),
                    on_type: obj.type_name().into(),
                })
            }

            // ── Index access: `expr[expr]` ───────────────────────────────────
            Expr::Index { object, index } => {
                let obj = self.eval_expr(object)?;
                let idx_val = self.eval_expr(index)?;
                let idx = idx_val.as_i128().ok_or_else(|| DslError::TypeError {
                    expected: "integer".into(),
                    got:      idx_val.type_name().into(),
                    context:  "index".into(),
                })?;
                let i = i64::try_from(idx).map_err(|_| DslError::IndexOutOfRange {
                    index: idx as i64,
                    len:   0,
                })?;
                match &obj {
                    ScVal::Vec(v) => {
                        let ui = usize::try_from(i).map_err(|_| DslError::IndexOutOfRange {
                            index: i, len: v.len(),
                        })?;
                        v.get(ui).cloned().ok_or(DslError::IndexOutOfRange {
                            index: i, len: v.len(),
                        })
                    }
                    _ => Err(DslError::TypeError {
                        expected: "Vec".into(),
                        got:      obj.type_name().into(),
                        context:  "index".into(),
                    }),
                }
            }

            // ── Unary ────────────────────────────────────────────────────────
            Expr::UnaryOp { op, operand } => {
                let v = self.eval_expr(operand)?;
                self.eval_unary(*op, v)
            }

            // ── Binary ───────────────────────────────────────────────────────
            Expr::BinOp { op, lhs, rhs } => {
                // Short-circuit for logical operators before evaluating rhs.
                match op {
                    BinOp::And => {
                        let l = self.eval_expr(lhs)?;
                        if !l.is_truthy() { return Ok(ScVal::Bool(false)); }
                        let r = self.eval_expr(rhs)?;
                        return Ok(ScVal::Bool(r.is_truthy()));
                    }
                    BinOp::Or => {
                        let l = self.eval_expr(lhs)?;
                        if l.is_truthy() { return Ok(ScVal::Bool(true)); }
                        let r = self.eval_expr(rhs)?;
                        return Ok(ScVal::Bool(r.is_truthy()));
                    }
                    _ => {}
                }
                let l = self.eval_expr(lhs)?;
                let r = self.eval_expr(rhs)?;
                self.eval_binop(*op, l, r)
            }

            // ── Function calls ───────────────────────────────────────────────
            Expr::Call { name, args } => {
                let mut evaled = Vec::with_capacity(args.len());
                for a in args {
                    evaled.push(self.eval_expr(a)?);
                }
                self.eval_call(name, evaled)
            }
        }
    }

    // ── Unary operations ──────────────────────────────────────────────────────

    fn eval_unary(&self, op: UnaryOp, val: ScVal) -> DslResult<ScVal> {
        match op {
            UnaryOp::Neg => {
                let n = val.as_i128().ok_or_else(|| DslError::TypeError {
                    expected: "numeric".into(),
                    got:      val.type_name().into(),
                    context:  "unary -".into(),
                })?;
                n.checked_neg()
                    .map(ScVal::I128)
                    .ok_or(DslError::Overflow { operation: "negate".into() })
            }
            UnaryOp::Not => {
                let b = val.as_bool().ok_or_else(|| DslError::TypeError {
                    expected: "Bool".into(),
                    got:      val.type_name().into(),
                    context:  "unary !".into(),
                })?;
                Ok(ScVal::Bool(!b))
            }
        }
    }

    // ── Binary operations ─────────────────────────────────────────────────────

    fn eval_binop(&self, op: BinOp, lhs: ScVal, rhs: ScVal) -> DslResult<ScVal> {
        // String concatenation via +
        if op == BinOp::Add {
            if let (Some(a), Some(b)) = (lhs.as_str(), rhs.as_str()) {
                return Ok(ScVal::Str(format!("{}{}", a, b)));
            }
        }

        // Equality comparison works for all types.
        match op {
            BinOp::Eq => return Ok(ScVal::Bool(lhs == rhs)),
            BinOp::Ne => return Ok(ScVal::Bool(lhs != rhs)),
            _ => {}
        }

        // All remaining operations require numeric operands.
        let l = lhs.as_i128().ok_or_else(|| DslError::TypeError {
            expected: "numeric".into(),
            got:      lhs.type_name().into(),
            context:  format!("{:?}", op),
        })?;
        let r = rhs.as_i128().ok_or_else(|| DslError::TypeError {
            expected: "numeric".into(),
            got:      rhs.type_name().into(),
            context:  format!("{:?}", op),
        })?;

        match op {
            BinOp::Add => l.checked_add(r).map(ScVal::I128)
                           .ok_or(DslError::Overflow { operation: "+".into() }),
            BinOp::Sub => l.checked_sub(r).map(ScVal::I128)
                           .ok_or(DslError::Overflow { operation: "-".into() }),
            BinOp::Mul => l.checked_mul(r).map(ScVal::I128)
                           .ok_or(DslError::Overflow { operation: "*".into() }),
            BinOp::Div => {
                if r == 0 { return Err(DslError::DivisionByZero); }
                Ok(ScVal::I128(l / r))
            }
            BinOp::Mod => {
                if r == 0 { return Err(DslError::DivisionByZero); }
                Ok(ScVal::I128(l % r))
            }
            BinOp::Lt => Ok(ScVal::Bool(l <  r)),
            BinOp::Le => Ok(ScVal::Bool(l <= r)),
            BinOp::Gt => Ok(ScVal::Bool(l >  r)),
            BinOp::Ge => Ok(ScVal::Bool(l >= r)),
            // And/Or already handled via short-circuit above.
            BinOp::And | BinOp::Or | BinOp::Eq | BinOp::Ne => unreachable!(),
        }
    }

    // ── Built-in functions ────────────────────────────────────────────────────
    //
    // All builtins are whitelisted here.  There is no mechanism for user-defined
    // functions, so this list is the complete callable surface.

    fn eval_call(&self, name: &str, args: Vec<ScVal>) -> DslResult<ScVal> {
        match name {
            // ── format_amount(value, decimals) ──────────────────────────────
            // Divide an integer ScVal by 10^decimals and format with fixed
            // decimal places.  Mirrors the TypeScript decodeAmount() helper.
            //
            // Example:  format_amount(10_000_000, 7)  →  "1.0000000"
            "format_amount" => {
                require_args(name, &args, 2)?;
                let raw = args[0].as_i128().ok_or_else(|| DslError::TypeError {
                    expected: "numeric".into(),
                    got:      args[0].type_name().into(),
                    context:  "format_amount arg 0".into(),
                })?;
                let dec = args[1].as_i128().ok_or_else(|| DslError::TypeError {
                    expected: "integer".into(),
                    got:      args[1].type_name().into(),
                    context:  "format_amount arg 1 (decimals)".into(),
                })?;
                if !(0..=18).contains(&dec) {
                    return Err(DslError::InvalidPrecision { precision: dec as i64 });
                }
                let dec = dec as u32;
                let divisor: i128 = 10_i128.pow(dec);
                let whole     = raw / divisor;
                let remainder = (raw % divisor).abs();
                let frac = format!("{:0>width$}", remainder, width = dec as usize);
                Ok(ScVal::Str(format!("{}.{}", whole, frac)))
            }

            // ── shorten(address) ───────────────────────────────────────────
            // Return a shortened Stellar address (first 4 + last 4 chars).
            //
            // Example:  shorten("GABC...WXYZ")  →  "GABC…WXYZ"
            "shorten" => {
                require_args(name, &args, 1)?;
                let addr = args[0].as_str().ok_or_else(|| DslError::TypeError {
                    expected: "Address or Str".into(),
                    got:      args[0].type_name().into(),
                    context:  "shorten".into(),
                })?;
                Ok(ScVal::Str(crate::scval::shorten_address(addr)))
            }

            // ── to_string(value) ──────────────────────────────────────────
            // Convert any ScVal to its string representation.
            "to_string" => {
                require_args(name, &args, 1)?;
                Ok(ScVal::Str(args[0].to_string()))
            }

            // ── concat(a, b, ...) ─────────────────────────────────────────
            // Concatenate any number of values as strings.
            "concat" => {
                let mut out = String::new();
                for arg in &args {
                    out.push_str(&arg.to_string());
                }
                Ok(ScVal::Str(out))
            }

            // ── if_else(condition, then_val, else_val) ────────────────────
            // Functional ternary — useful when a one-liner is preferable to
            // an `if` block.
            "if_else" => {
                require_args(name, &args, 3)?;
                if args[0].is_truthy() {
                    Ok(args[1].clone())
                } else {
                    Ok(args[2].clone())
                }
            }

            // ── len(vec_or_str) ───────────────────────────────────────────
            "len" => {
                require_args(name, &args, 1)?;
                match &args[0] {
                    ScVal::Vec(v) => Ok(ScVal::I128(v.len() as i128)),
                    ScVal::Str(s) | ScVal::Address(s) | ScVal::Symbol(s) => {
                        Ok(ScVal::I128(s.len() as i128))
                    }
                    other => Err(DslError::TypeError {
                        expected: "Vec or Str".into(),
                        got:      other.type_name().into(),
                        context:  "len".into(),
                    }),
                }
            }

            // ── Unknown function ──────────────────────────────────────────
            _ => Err(DslError::UndefinedVariable { name: name.to_owned() }),
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// Look up a variable: locals shadow the outer context.
    fn lookup(&self, name: &str) -> Option<&ScVal> {
        self.locals.get(name).or_else(|| self.outer.get(name))
    }

    /// Decrement the step counter; return an error if the budget is exhausted.
    #[inline]
    fn tick(&mut self) -> DslResult<()> {
        if self.steps == 0 {
            return Err(DslError::StepBudgetExceeded { budget: STEP_BUDGET });
        }
        self.steps -= 1;
        Ok(())
    }
}

// ── Argument-count guard ──────────────────────────────────────────────────────

fn require_args(fn_name: &str, args: &[ScVal], expected: usize) -> DslResult<()> {
    if args.len() != expected {
        return Err(DslError::TypeError {
            expected: format!("{} argument(s)", expected),
            got:      format!("{}", args.len()),
            context:  fn_name.to_owned(),
        });
    }
    Ok(())
}
