# Cloudflare Turnstile CAPTCHA Setup Guide

## Overview

This guide walks you through setting up Cloudflare Turnstile as your CAPTCHA solution for the Inspekto email verification system. Turnstile is a modern, privacy-first CAPTCHA alternative that's easy to integrate and highly reliable.

## Why Turnstile?

- **Industry Standard**: Used by thousands of websites globally
- **Privacy-Focused**: Doesn't track users across the web
- **Flexible**: Multiple challenge modes (Managed, Non-Interactive, Invisible)
- **Reliable**: 99.9% uptime SLA
- **Developer-Friendly**: Simple API and excellent documentation
- **Free Tier**: Generous free tier for development and small projects

## Prerequisites

- Cloudflare account (free tier available at https://dash.cloudflare.com)
- Your application domain (or localhost for development)
- Supabase project with Edge Functions enabled

## Step 1: Create a Cloudflare Account

1. Go to https://dash.cloudflare.com/sign-up
2. Sign up with your email or use an existing account
3. Verify your email address

## Step 2: Get Your Turnstile Site Key and Secret Key

### For Production Domain:

1. Log in to Cloudflare Dashboard: https://dash.cloudflare.com
2. Navigate to **Turnstile** in the left sidebar
3. Click **Create Site**
4. Fill in the form:
   - **Site name**: "Inspekto" (or your app name)
   - **Domains**: Add your production domain (e.g., `inspekto.gov.ph`)
   - **Mode**: Select "Managed" (recommended for most use cases)
     - **Managed**: Shows a checkbox or challenge based on risk assessment
     - **Non-Interactive**: No user interaction required (for backend verification)
     - **Invisible**: Completely invisible to users
5. Click **Create**
6. You'll see your **Site Key** and **Secret Key**
   - **Site Key**: Public, used in frontend
   - **Secret Key**: Private, used in backend (keep this secret!)

### For Development (localhost):

1. Repeat the same process but add `localhost` as a domain
2. You can have multiple sites for different environments

## Step 3: Configure Environment Variables

### Frontend (.env or .env.local)

Add your Site Key to your frontend environment:

```env
VITE_TURNSTILE_SITE_KEY=your_site_key_here
```

**Important**: The `VITE_` prefix makes this variable accessible in your React app via `import.meta.env.VITE_TURNSTILE_SITE_KEY`

### Backend (Supabase Edge Function Secrets)

Add your Secret Key to Supabase:

1. Go to your Supabase project dashboard
2. Navigate to **Settings** → **Edge Functions**
3. Click **Add Secret**
4. Add the following secret:
   ```
   Name: TURNSTILE_SECRET_KEY
   Value: your_secret_key_here
   ```

**Important**: Never commit your secret key to version control!

## Step 4: Deploy Edge Function

Deploy the updated `request-email-verification` function to Supabase:

```bash
# From your project root
supabase functions deploy request-email-verification
```

Or if using Supabase CLI:

```bash
supabase functions deploy request-email-verification --project-id your_project_id
```

## Step 5: Test the Integration

### Local Testing

1. Start your development server:
   ```bash
   npm run dev
   ```

2. Navigate to the email verification modal
3. You should see the Turnstile widget (a checkbox or challenge)
4. Complete the CAPTCHA
5. Submit the form
6. Check that the verification email is sent

### Troubleshooting Local Testing

If the widget doesn't appear:

1. **Check Site Key**: Ensure `VITE_TURNSTILE_SITE_KEY` is set correctly
2. **Check Domain**: Make sure `localhost` is added to your Turnstile site domains
3. **Check Console**: Look for errors in browser console (F12 → Console tab)
4. **Clear Cache**: Hard refresh (Ctrl+Shift+R or Cmd+Shift+R)

## Step 6: Production Deployment

### Before Going Live

1. **Verify Domain**: Ensure your production domain is added to Turnstile site
2. **Test Staging**: Deploy to staging environment first
3. **Monitor**: Set up error tracking to catch any issues
4. **Rate Limiting**: Consider implementing rate limiting on your backend

### Deployment Steps

1. Update your production environment variables:
   ```env
   VITE_TURNSTILE_SITE_KEY=your_production_site_key
   ```

2. Deploy your frontend to production

3. Ensure Supabase Edge Function has the production secret key:
   ```
   TURNSTILE_SECRET_KEY=your_production_secret_key
   ```

4. Deploy Edge Function to production

## How It Works

### User Flow

```
1. User opens Email Verification Modal
2. Enters email address
3. Turnstile widget loads and displays challenge
4. User completes the challenge (checkbox, puzzle, etc.)
5. Turnstile generates a token
6. User clicks "Send Verification Link"
7. Frontend sends email + Turnstile token to backend
8. Backend verifies token with Cloudflare API
9. If valid, verification email is sent
10. Success message is displayed
```

### Technical Flow

```
Frontend                          Cloudflare              Backend
  |                                  |                      |
  |-- Load Turnstile widget          |                      |
  |<-- Widget ready                  |                      |
  |-- User completes challenge       |                      |
  |<-- Token generated               |                      |
  |-- Submit form with token         |                      |
  |-- Send email + token ---------------------------------------->|
  |                                  |                      |
  |                                  |-- Verify token ------>|
  |                                  |<-- Valid/Invalid -----|
  |                                  |                      |
  |                                  |                      |-- Send email
  |                                  |                      |-- Return success
  |<------ Response received --------|                      |
  |-- Show success message           |                      |
```

## Configuration Options

### Turnstile Widget Modes

The widget is currently set to "Managed" mode. You can change it in `EmailVerificationModal.jsx`:

```jsx
<div
  ref={turnstileRef}
  className="cf-turnstile"
  data-sitekey={import.meta.env.VITE_TURNSTILE_SITE_KEY}
  data-theme="light"
  data-size="normal"  // or "compact"
></div>
```

**Available Options:**
- `data-theme`: "light" or "dark"
- `data-size`: "normal" or "compact"
- `data-tabindex`: Tab order (default: 0)

### Backend Verification

The backend verifies tokens by calling Cloudflare's verification endpoint:

```
POST https://challenges.cloudflare.com/turnstile/v0/siteverify
```

Response includes:
- `success`: Boolean indicating if verification passed
- `challenge_ts`: Timestamp of when the challenge was completed
- `hostname`: The hostname where the challenge was completed
- `error_codes`: Array of error codes if verification failed

## Security Considerations

### Frontend Security

- **Site Key is Public**: It's safe to expose in your frontend code
- **No Sensitive Data**: Never send sensitive information in the CAPTCHA token
- **HTTPS Only**: Always use HTTPS in production

### Backend Security

- **Secret Key is Private**: Never expose this in frontend code or version control
- **Verify on Backend**: Always verify tokens on the backend, never trust frontend
- **Rate Limiting**: Implement rate limiting to prevent abuse
- **Token Expiration**: Tokens expire after a short time (typically 5 minutes)

### Best Practices

1. **Environment Variables**: Use `.env` files and never commit secrets
2. **HTTPS**: Always use HTTPS in production
3. **Rate Limiting**: Implement per-IP rate limiting on your backend
4. **Logging**: Log verification failures for monitoring
5. **Error Handling**: Don't expose internal errors to users

## Monitoring and Analytics

### Cloudflare Dashboard

1. Go to Turnstile in Cloudflare Dashboard
2. Click on your site
3. View analytics:
   - Challenge completion rate
   - Verification success rate
   - Geographic distribution
   - Device types

### Backend Monitoring

Monitor these metrics in your Edge Function logs:
- Verification success rate
- Verification failure rate
- API response times
- Error codes

## Troubleshooting

### Widget Not Appearing

**Problem**: The Turnstile widget doesn't show up on the page

**Solutions**:
1. Check that `VITE_TURNSTILE_SITE_KEY` is set correctly
2. Verify your domain is added to Turnstile site
3. Check browser console for errors
4. Ensure the Turnstile script is loaded: `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`

### Verification Failing

**Problem**: Users complete the CAPTCHA but verification fails

**Solutions**:
1. Check that `TURNSTILE_SECRET_KEY` is set in Supabase secrets
2. Verify the secret key is correct (copy-paste carefully)
3. Check Edge Function logs for errors
4. Ensure your backend can reach Cloudflare API (check firewall/proxy)

### Token Expired

**Problem**: "CAPTCHA verification failed" error

**Solutions**:
1. Tokens expire after ~5 minutes, user needs to refresh
2. Implement a "Refresh CAPTCHA" button if needed
3. Consider increasing timeout if users are slow

### CORS Issues

**Problem**: Browser console shows CORS errors

**Solutions**:
1. Ensure your domain is added to Turnstile site
2. Check that your backend allows requests from your frontend domain
3. Verify HTTPS is being used in production

## Migration from Altcha

If you're migrating from Altcha:

1. **Frontend Changes**: Already done - widget replaced
2. **Backend Changes**: Already done - verification function updated
3. **Environment Variables**: Add `VITE_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`
4. **Testing**: Test thoroughly before deploying to production
5. **Rollback Plan**: Keep Altcha code in version control for quick rollback if needed

## Support and Resources

- **Cloudflare Turnstile Docs**: https://developers.cloudflare.com/turnstile/
- **Turnstile API Reference**: https://developers.cloudflare.com/turnstile/api/
- **Cloudflare Community**: https://community.cloudflare.com/
- **GitHub Issues**: Report issues in your project repository

## FAQ

### Q: Is Turnstile free?
**A**: Yes, Turnstile has a generous free tier. Check Cloudflare pricing for details.

### Q: Can I use Turnstile without a Cloudflare domain?
**A**: Yes, you don't need to use Cloudflare for your domain. Just create a Turnstile site and add your domain.

### Q: How often do tokens expire?
**A**: Tokens typically expire after 5 minutes. Users need to complete a new challenge if they wait too long.

### Q: Can I customize the widget appearance?
**A**: Yes, you can change the theme (light/dark) and size (normal/compact). For more customization, use the Non-Interactive mode.

### Q: What happens if Cloudflare API is down?
**A**: Your verification will fail. Consider implementing a fallback or retry mechanism.

### Q: Can I test with localhost?
**A**: Yes, add `localhost` to your Turnstile site domains for local testing.

## Next Steps

1. ✅ Create Cloudflare account
2. ✅ Get Site Key and Secret Key
3. ✅ Configure environment variables
4. ✅ Deploy Edge Function
5. ✅ Test locally
6. ✅ Deploy to production
7. ✅ Monitor and maintain

## Maintenance

### Regular Tasks

- **Monitor Analytics**: Check Turnstile dashboard weekly
- **Review Logs**: Check Edge Function logs for errors
- **Update Dependencies**: Keep Cloudflare API up to date
- **Security Audit**: Review security settings quarterly

### Updating Configuration

To update Turnstile settings:

1. Go to Cloudflare Dashboard → Turnstile
2. Click on your site
3. Modify settings as needed
4. Changes take effect immediately

## Version History

- **v1.0** (Current): Cloudflare Turnstile integration
- **v0.1**: Altcha integration (deprecated)

---

**Last Updated**: 2024
**Maintained By**: Development Team
