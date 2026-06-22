# 🚀 Registry Linter - Quick Start Guide

> **Get up and running with the 3-tier validation pipeline in 2 minutes**

---

## ⚡ Installation (30 seconds)

```bash
# Navigate to project directory
cd "c:\Users\Admin\Desktop\Issues on ground\Open-Audit"

# Install dependencies (includes ajv and tsx)
npm install
```

---

## ✅ Test It Works (30 seconds)

### Test 1: Validate Current Registry (Should Pass ✅)

```bash
npm run lint:registry
```

**Expected output**:
```
✅ ALL VALIDATION CHECKS PASSED
25 registry entries validated successfully.
```

### Test 2: Validate Bad Example (Should Fail ❌)

```bash
# Windows
copy lib\translator\registry.bad-example.json lib\translator\registry.json
npm run lint:registry
git checkout lib/translator/registry.json

# Linux/Mac
cp lib/translator/registry.bad-example.json lib/translator/registry.json
npm run lint:registry
git checkout lib/translator/registry.json
```

**Expected output**:
```
❌ TRANSLATION REGISTRY VALIDATION FAILED
Total: 10+ error(s), 0 warning(s)
```

---

## 📖 For Contributors

### Before Committing

```bash
npm run lint:registry
```

If you see errors:
1. Read the error message (it tells you exactly what's wrong)
2. Find the entry by index number
3. Fix the issue
4. Run again

### Common Fixes

**Error**: `Template references '{value}' but event_structure only provides [amount]`  
**Fix**: Change `{value}` to `{amount}` in your template

**Error**: `Topics array length mismatch`  
**Fix**: Ensure `topics.length = event_structure.topics.length + 1`

**Error**: `Duplicate entry detected`  
**Fix**: Remove one of the duplicate entries

---

## 📖 For Reviewers

The GitHub Actions workflow runs automatically on PRs.

1. Look for green checkmark ✅ on PR
2. If red ❌, check Actions tab for details
3. PR is blocked from merging until validation passes

---

## 📚 Documentation

Start with these (in order):

1. **[DELIVERABLES.md](DELIVERABLES.md)** - What was delivered and how it works
2. **[REGISTRY_LINTER_README.md](REGISTRY_LINTER_README.md)** - Visual quick reference
3. **[REGISTRY_VALIDATION.md](REGISTRY_VALIDATION.md)** - Complete usage guide (300+ lines)
4. **[TEST_LINTER.md](TEST_LINTER.md)** - Detailed testing procedures

---

## 🎯 What You Get

✅ **Tier 1**: JSON schema validation (structure, types, format)  
✅ **Tier 2**: Template variable cross-examination  
✅ **Tier 3**: Logical consistency checks (duplicates, alignment)  

✅ **GitHub Actions**: Automatic PR validation  
✅ **Path Filtering**: Only runs when registry changes  
✅ **Clear Errors**: Tells you exactly what's wrong and where  

---

## 🎓 Commands Reference

```bash
# Full 3-tier validation
npm run lint:registry

# Schema-only validation (faster, legacy)
npm run validate:registry

# View installed packages
npm list ajv tsx
```

---

## 📁 Key Files

```
.github/workflows/
  └── registry-lint.yml          # GitHub Actions workflow

lib/translator/
  ├── registry.json              # Main registry (validated)
  ├── registry.schema.json       # JSON schema
  └── registry.bad-example.json  # Test file with errors

scripts/
  ├── lint-registry.ts           # Advanced 3-tier linter
  └── validate-registry.ts       # Legacy schema validator

Documentation/
  ├── QUICK_START.md             # This file
  ├── DELIVERABLES.md            # Complete deliverables list
  ├── REGISTRY_VALIDATION.md     # Full usage guide
  ├── TEST_LINTER.md             # Testing guide
  └── SCHEMA_ENHANCEMENTS.md     # Schema details
```

---

## ❓ Common Questions

**Q: Do I need to run validation manually?**  
A: Recommended before pushing, but GitHub Actions will catch errors anyway.

**Q: How long does validation take?**  
A: < 1 second for small registries, < 5 seconds for large ones.

**Q: What if I get an error I don't understand?**  
A: Check `REGISTRY_VALIDATION.md` section "Common Errors and Fixes".

**Q: Can I skip validation?**  
A: No, PRs are blocked until validation passes (by design).

**Q: What happens if validation fails in CI?**  
A: PR is blocked, you get a comment with fix instructions, check Actions tab for details.

---

## 🐛 Troubleshooting

**Error: "Cannot find module 'ajv'"**  
```bash
npm install
```

**Error: "tsx: command not found"**  
```bash
npm install tsx --save-dev
```

**Validation passes locally but fails in CI**  
- Check Node.js version (need v20+)
- Ensure you committed all changes
- Check CI logs in Actions tab

---

## ✨ That's It!

You're all set! The validation pipeline is active and will automatically check all registry changes in PRs.

**Next steps**:
1. ✅ You've installed dependencies
2. ✅ You've tested it works
3. ✅ You know the commands
4. 🎉 Start contributing!

---

**Need more help?** See [DELIVERABLES.md](DELIVERABLES.md) for complete documentation index.

**Ready to contribute?** Run `npm run lint:registry` before committing!

🚀 Happy coding!
