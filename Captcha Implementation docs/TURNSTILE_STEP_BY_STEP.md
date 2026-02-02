# Cloudflare Turnstile: Step-by-Step Setup

## Complete Setup Instructions

Follow these steps in order to get Turnstile working with your Inspekto application.

---

## Phase 1: Cloudflare Account Setup (5 minutes)

### Step 1.1: Create Cloudflare Account
1. Go to https://dash.cloudflare.com/sign-up
2. Enter your email address
3. Create a password
4. Check the "I agree to the Cloudflare Terms of Service" checkbox
5. Click "Create account"
6. Verify your email address

### Step 1.2: Access Turnstile
1. Log in to Cloudflare Dashboard: https://dash.cloudflare.com
2. In the left sidebar, find and click **Turnstile**
3. You should see "Turnstile" in the main navigation

---

## Phase 2: Create Turnstile Site (3 minutes)

### Step 2.1: Create New Site
1. Click **Create Site** button
2. Fill in the form:

   **Site name**: 
   ```
   Inspekto
   ```

   **Domains**: 
   - For development: `localhost`
   - For production: `inspekto.gov.ph` (or your domain)
   - You can add multiple domains

   **Mode**: Select **Managed**
   - Managed: Recommended (shows checkbox or challenge based on risk)
   - Non-Interactive: No user interaction
   - Invisible: Completely hidden

3. Click **Create**

### Step 2.2: Copy Your Keys
After creation, you'll see:

```
Site Key:     1x00000000000000000000AA
Secret Key:   0x4AAAAAADnMXxxx0Xxx00000XXxXXXXXXXXXXXXX
```

**Important**: 
- ✅ Site Key: Safe to share, use in frontend
- ❌ Secret Key: Keep private, use only in backend

---

## Phase 3: Frontend Configuration (2 minutes)

### Step 3.1: Create Environment File
In your project root, create or edit `.env.local`:

```env
VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA
```

Replace `1x00000000000000000000AA` with your actual Site Key.

### Step 3.2: Verify Frontend Code
Check that `EmailVerificationModal.jsx` has:

```jsx
<div
  ref={turnstileRef}
  className="cf-turnstile"
  data-sitekey={import.meta.env.VITE_TURNSTILE_SITE_KEY}
  data-theme="light"
></div>
```

✅ This is already done in the updated code.

---

## Phase 4: Backend Configuration (3 minutes)

### Step 4.1: Add Secret to Supabase

1. Go to your Supabase project: https://app.supabase.com
2. Select your project
3. Go to **Settings** → **Edge Functions** (or **Functions** → **Secrets**)
4. Click **Add Secret**
5. Fill in:
   ```
   Name: TURNSTILE_SECRET_KEY
   Value: 0x4AAAAAADnMXxxx0Xxx00000XXxXXXXXXXXXXXXX
   ```
   Replace with your actual Secret Key
6. Click **Add Secret**

### Step 4.2: Verify Backend Code
Check that `request-email-verification/index.ts` has:

```typescript
async function verifyTurnstileToken(token: string): Promise<boolean> {
  try {
    const secretKey = Deno.env.get("TURNSTILE_SECRET_KEY");
    // ... verification logic
  }
}
```

✅ This is already done in the updated code.

---

## Phase 5: Deploy Edge Function (2 minutes)

### Step 5.1: Deploy to Supabase

From your project root:

```bash
supabase functions deploy request-email-verification
```

Or with project ID:

```bash
supabase functions deploy request-email-verification --project-id your_project_id
```

Expected output:
```
✓ Function deployed successfully
```

### Step 5.2: Verify Deployment

1. Go to Supabase dashboard
2. Navigate to **Edge Functions**
3. Click on `request-email-verification`
4. Verify the function is listed and active

---

## Phase 6: Local Testing (5 minutes)

### Step 6.1: Start Development Server

```bash
npm run dev
```

You should see:
```
  VITE v7.2.4  ready in 123 ms

  ➜  Local:   http://localhost:5173/
  ➜  press h to show help
```

### Step 6.2: Test the Modal

1. Open http://localhost:5173 in your browser
2. Click on "Submit a Complaint" or the button that opens the Email Verification Modal
3. You should see:
   - Email input field
   - **Turnstile widget** (checkbox or challenge)
   - "Send Verification Link" button

### Step 6.3: Complete CAPTCHA

1. Look for the Turnstile widget (usually a checkbox saying "I'm not a robot")
2. Click the checkbox
3. Complete any challenge if prompted
4. The widget should show a checkmark

### Step 6.4: Submit Form

1. Enter a test email: `test@example.com`
2. Click "Send Verification Link"
3. You should see a success message

### Step 6.5: Check Logs

1. Open browser console (F12)
2. Check for any errors
3. Go to Supabase dashboard → Edge Functions → Logs
4. Verify the function was called successfully

---

## Phase 7: Troubleshooting (if needed)

### Issue: Widget Not Showing

**Symptoms**: No Turnstile widget appears on the modal

**Solutions**:
1. Check `.env.local` has `VITE_TURNSTILE_SITE_KEY`
2. Verify Site Key is correct (copy-paste from Cloudflare)
3. Add `localhost` to Turnstile site domains in Cloudflare
4. Hard refresh browser (Ctrl+Shift+R)
5. Check browser console for errors (F12)

### Issue: Verification Fails

**Symptoms**: "CAPTCHA verification failed" error after completing challenge

**Solutions**:
1. Check Supabase has `TURNSTILE_SECRET_KEY` secret
2. Verify Secret Key is correct (copy-paste from Cloudflare)
3. Check Edge Function logs for errors
4. Ensure backend can reach Cloudflare API (check firewall)

### Issue: Token Expired

**Symptoms**: "CAPTCHA verification failed" after waiting

**Solutions**:
1. Tokens expire after ~5 minutes
2. User needs to refresh the CAPTCHA
3. This is normal behavior

### Issue: CORS Errors

**Symptoms**: Browser console shows CORS errors

**Solutions**:
1. Add your domain to Turnstile site in Cloudflare
2. Use HTTPS in production
3. Check that your backend allows requests from your frontend

---

## Phase 8: Production Deployment (5 minutes)

### Step 8.1: Create Production Turnstile Site

1. Go to Cloudflare Dashboard → Turnstile
2. Click **Create Site**
3. Fill in:
   - **Site name**: `Inspekto Production`
   - **Domains**: `inspekto.gov.ph` (your production domain)
   - **Mode**: `Managed`
4. Click **Create**
5. Copy the Site Key and Secret Key

### Step 8.2: Update Production Environment

**Frontend (.env.production or deployment config)**:
```env
VITE_TURNSTILE_SITE_KEY=your_production_site_key
```

**Backend (Supabase Production Secrets)**:
```
TURNSTILE_SECRET_KEY=your_production_secret_key
```

### Step 8.3: Deploy

1. Build frontend:
   ```bash
   npm run build
   ```

2. Deploy Edge Function:
   ```bash
   supabase functions deploy request-email-verification --project-id your_production_project_id
   ```

3. Deploy frontend to your hosting (Vercel, Netlify, etc.)

### Step 8.4: Test Production

1. Go to your production URL
2. Test the email verification flow
3. Verify email is sent successfully
4. Check Turnstile dashboard for analytics

---

## Phase 9: Monitoring Setup (5 minutes)

### Step 9.1: Monitor Turnstile Dashboard

1. Go to Cloudflare Dashboard → Turnstile
2. Click on your site
3. View analytics:
   - Challenge completion rate
   - Verification success rate
   - Geographic distribution

### Step 9.2: Monitor Edge Function Logs

1. Go to Supabase Dashboard
2. Navigate to **Edge Functions**
3. Click on `request-email-verification`
4. View logs for errors and performance

### Step 9.3: Set Up Alerts (Optional)

1. In Supabase, set up notifications for function errors
2. In Cloudflare, enable email notifications for issues
3. Monitor verification success rate

---

## Phase 10: Verification Checklist

Before considering setup complete, verify:

- [ ] Cloudflare account created
- [ ] Turnstile site created
- [ ] Site Key and Secret Key obtained
- [ ] `.env.local` has `VITE_TURNSTILE_SITE_KEY`
- [ ] Supabase has `TURNSTILE_SECRET_KEY` secret
- [ ] Edge Function deployed successfully
- [ ] Widget appears on modal
- [ ] CAPTCHA can be completed
- [ ] Verification email is sent
- [ ] No errors in browser console
- [ ] No errors in Edge Function logs
- [ ] Production domain added to Turnstile
- [ ] Production deployment tested

---

## Quick Reference

### Environment Variables

**Frontend**:
```env
VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA
```

**Backend**:
```
TURNSTILE_SECRET_KEY=0x4AAAAAADnMXxxx0Xxx00000XXxXXXXXXXXXXXXX
```

### Key URLs

- Cloudflare Dashboard: https://dash.cloudflare.com
- Turnstile: https://dash.cloudflare.com/turnstile
- Supabase Dashboard: https://app.supabase.com
- Turnstile Docs: https://developers.cloudflare.com/turnstile/

### Commands

```bash
# Start development
npm run dev

# Build for production
npm run build

# Deploy Edge Function
supabase functions deploy request-email-verification

# View Edge Function logs
supabase functions logs request-email-verification
```

---

## Support

If you encounter issues:

1. **Check Documentation**: Review `TURNSTILE_SETUP.md` for detailed info
2. **Check Logs**: Look at browser console and Edge Function logs
3. **Check Configuration**: Verify all environment variables are set
4. **Check Cloudflare**: Verify domain is added to Turnstile site
5. **Contact Support**: Reach out to Cloudflare or Supabase support

---

## Next Steps

After successful setup:

1. ✅ Monitor the system for a few days
2. ✅ Check analytics in Turnstile dashboard
3. ✅ Review Edge Function logs for errors
4. ✅ Gather user feedback
5. ✅ Make any necessary adjustments

---

**Setup Time**: ~30 minutes total
**Difficulty**: Easy
**Status**: Ready for Production

Good luck! 🚀
