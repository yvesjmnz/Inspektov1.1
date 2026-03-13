# Phase 3 LLM Setup Guide

## Problem Fixed

**Error**: `process is not defined` in browser environment

**Solution**: Changed from Node.js `process.env` to Vite's `import.meta.env`

---

## Environment Variables

Vite uses `VITE_` prefix for client-side environment variables.

### Setup Steps

1. **Create `.env.local` file** in project root:
   ```bash
   cp .env.example .env.local
   ```

2. **Choose your LLM provider** and add credentials:

   **Option A: OpenAI**
   ```
   VITE_LLM_PROVIDER=openai
   VITE_LLM_API_KEY=sk-...
   VITE_LLM_MODEL=gpt-3.5-turbo
   ```
   - Get API key: https://platform.openai.com/api-keys
   - Cost: ~$0.001-0.002 per request

   **Option B: Claude (Anthropic)**
   ```
   VITE_LLM_PROVIDER=claude
   VITE_LLM_API_KEY=sk-ant-...
   VITE_LLM_MODEL=claude-3-haiku-20240307
   ```
   - Get API key: https://console.anthropic.com/
   - Cost: ~$0.00025 per request (cheaper)

   **Option C: Gemini (Google)**
   ```
   VITE_LLM_PROVIDER=gemini
   VITE_LLM_API_KEY=AIza...
   VITE_LLM_MODEL=gemini-pro
   ```
   - Get API key: https://makersuite.google.com/app/apikey
   - Cost: Free tier available

3. **Restart dev server**:
   ```bash
   npm run dev
   ```

---

## How It Works

### Configuration Loading
```javascript
const LLM_CONFIG = {
  provider: import.meta.env.VITE_LLM_PROVIDER || 'openai',
  apiKey: import.meta.env.VITE_LLM_API_KEY,
  model: import.meta.env.VITE_LLM_MODEL || 'gpt-3.5-turbo',
};
```

### Usage in Code
```javascript
import { analyzeComplaintWithLLM, isLLMConfigured } from '@/lib/complaints/llmService';

// Check if LLM is available
if (isLLMConfigured()) {
  const result = await analyzeComplaintWithLLM(complaint);
  // result.success = true/false
  // result.data = { riskLevel, keyConcerns, recommendedAction, reasoning }
}
```

---

## Testing

### Without LLM (Default)
- All Phase 1 & 2 features work normally
- LLM analysis button is hidden/disabled
- No API calls made

### With LLM Configured
- LLM analysis button appears
- Director can click to get AI-powered risk assessment
- Results displayed in collapsible card

---

## Troubleshooting

### "LLM API key not configured"
- Check `.env.local` file exists
- Verify `VITE_LLM_API_KEY` is set
- Restart dev server after adding env vars

### "Unknown LLM provider"
- Check `VITE_LLM_PROVIDER` is one of: `openai`, `claude`, `gemini`
- Default is `openai` if not specified

### API Errors
- Verify API key is correct
- Check API key has proper permissions
- Verify rate limits not exceeded
- Check network connectivity

---

## Cost Estimates

| Provider | Cost per Request | Monthly (1000 requests) |
|----------|------------------|------------------------|
| OpenAI (GPT-3.5) | $0.001-0.002 | $1-2 |
| Claude (Haiku) | $0.00025 | $0.25 |
| Gemini | Free (limited) | Free |

---

## Security Notes

⚠️ **Never commit `.env.local` to git**
- Add to `.gitignore` (already done)
- API keys are sensitive credentials
- Use `.env.example` for documentation only

✅ **Best Practices**
- Use environment-specific keys
- Rotate keys regularly
- Monitor API usage
- Set rate limits in provider dashboard

---

## Next Steps

1. Choose your LLM provider
2. Get API key from provider
3. Create `.env.local` with credentials
4. Restart dev server
5. Test LLM analysis on complaint review page

---

**Status**: ✅ Fixed - Ready to use with proper environment configuration
