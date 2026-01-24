# Inspekto - Complaint Management System Frontend

A modern React-based frontend for the Inspekto complaint management system, enabling citizens and government offices to report business violations.

## Features

- **Email Verification Flow**: Secure email verification before complaint submission
- **Complaint Form**: Comprehensive form for submitting business violation complaints
- **Business Search**: Search and select from existing businesses in the database
- **File Uploads**: Support for images and documents as evidence
- **Responsive Design**: Mobile-friendly interface
- **Real-time Validation**: Client-side form validation

## Project Structure

```
src/
├── components/
│   ├── VerifyEmail.jsx          # Email verification page
│   ├── VerifyEmail.css
│   ├── RequestVerification.jsx  # Email verification request page
│   ├── RequestVerification.css
│   ├── ComplaintForm.jsx        # Main complaint submission form
│   └── ComplaintForm.css
├── lib/
│   ├── supabase.js              # Supabase client initialization
│   ├── api.js                   # API functions for edge functions
│   ├── complaints.js            # Complaint-related database operations
│   └── router.js                # Simple routing utility
├── App.jsx                      # Main application component
├── App.css                      # Global styles
├── main.jsx                     # React entry point
└── index.css                    # Base styles
```

## Setup Instructions

### Prerequisites

- Node.js 16+ and npm
- Supabase project with the database schema set up
- Supabase storage bucket named `storage-images`
- Edge functions deployed: `verify-email` and `request-email-verification`

### Installation

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables in `.env`:
```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_API_BASE_URL=http://localhost:54321/functions/v1
```

3. Start the development server:
```bash
npm run dev
```

The application will be available at `http://localhost:5173`

## Usage Flow

### 1. Request Email Verification
- User navigates to `/request-verification`
- Enters their email address
- System sends verification email with time-bound link

### 2. Verify Email
- User clicks link in email
- Redirected to `/verify-email?token=...`
- Email is verified and user is redirected to complaint form

### 3. Submit Complaint
- User fills out complaint form with:
  - Business name (searchable)
  - Business address
  - Complaint description
  - Supporting images and documents
- System validates and submits complaint to database
- Complaint is marked with verified email

## API Integration

### Edge Functions

The frontend integrates with two Supabase edge functions:

#### `request-email-verification`
- **Method**: POST
- **Body**: `{ email: string, complaintId?: string }`
- **Response**: `{ success: boolean }`

#### `verify-email`
- **Method**: POST
- **Body**: `{ token: string }`
- **Response**: `{ success: boolean, email: string, complaintId: string | null }`

### Database Operations

The frontend uses Supabase client to interact with:
- `businesses` table - Search and retrieve business information
- `complaints` table - Submit new complaints
- `storage-images` bucket - Upload images and documents

## Component Details

### VerifyEmail Component
Handles email verification with automatic token extraction from URL parameters. Shows loading state during verification and success/error states.

### RequestVerification Component
Collects email address and triggers verification email sending. Provides feedback on email delivery status.

### ComplaintForm Component
Main form for complaint submission with:
- Business search with autocomplete
- Multi-file upload for images and documents
- Real-time form validation
- Success confirmation

## Styling

The application uses a modern gradient-based design with:
- Primary gradient: `#667eea` to `#764ba2`
- Responsive grid layouts
- Smooth transitions and hover effects
- Mobile-first approach

## Error Handling

All components include comprehensive error handling:
- Network error messages
- Validation error feedback
- User-friendly error states
- Retry mechanisms

## Development

### Build for Production
```bash
npm run build
```

### Lint Code
```bash
npm run lint
```

### Preview Production Build
```bash
npm run preview
```

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers (iOS Safari, Chrome Mobile)

## Notes

- The application uses client-side routing without a router library for simplicity
- All API calls include proper CORS headers
- File uploads are handled through Supabase storage
- Email verification tokens are single-use and time-bound
