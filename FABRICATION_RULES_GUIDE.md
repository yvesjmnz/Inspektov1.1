# Fabrication-Related Authenticity Rules - Implementation Guide

## Overview

This implementation provides 4 stored procedures in Supabase that check fabrication-related authenticity rules:

1. **Establishment History** - Checks if complaint aligns with establishment's violation history
2. **Reporter Credibility** - Checks if reporter has founded complaints
3. **Reporter Under Review** - Checks if reporter has unfounded complaint pattern
4. **Post-Clearance Complaints** - Checks if reporter files same complaint after clearance

## Architecture

```
Frontend (React)
    ↓
fabricationRules.js (JavaScript wrapper)
    ↓
Supabase RPC Calls
    ↓
Stored Procedures (PostgreSQL)
    ↓
Database Tables (inspection_slips, complaints)
```

## Setup Instructions

### 1. Deploy Stored Procedures

Run the migration file in Supabase:

```bash
# Option A: Via Supabase Dashboard
# Go to SQL Editor → New Query → Paste content from:
# supabase/migrations/20250101000000_fabrication_authenticity_rules.sql

# Option B: Via CLI
supabase db push
```

### 2. Verify Procedures Created

In Supabase SQL Editor, run:

```sql
-- List all procedures
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_name LIKE '%fabrication%' OR routine_name LIKE '%establishment%' OR routine_name LIKE '%reporter%' OR routine_name LIKE '%clearance%';
```

Expected results:
- `check_establishment_history`
- `check_reporter_credibility`
- `check_reporter_under_review`
- `check_post_clearance_complaint`
- `calculate_fabrication_tags`
- `get_fabrication_tags`

### 3. Enable RPC in Supabase

Ensure RPC is enabled for your project (usually enabled by default).

## Usage Examples

### Frontend Usage

```javascript
import { calculateFabricationTags } from '@/lib/complaints/fabricationRules';

// In your complaint form component
const result = await calculateFabricationTags(
  'reporter@example.com',
  'ABC Restaurant',
  'health'
);

console.log(result);
// Output:
// {
//   tags: ['Credible Reporter', 'Consistent With History'],
//   tag_count: 2,
//   analysis: {
//     establishment_history: { tag: 'Consistent With History', ... },
//     reporter_credibility: { tag: 'Credible Reporter', ... },
//     reporter_under_review: { tag: null, ... },
//     post_clearance: { tag: null, ... }
//   }
// }
```

### Individual Rule Checks

```javascript
import {
  checkEstablishmentHistory,
  checkReporterCredibility,
  checkReporterUnderReview,
  checkPostClearanceComplaint,
} from '@/lib/complaints/fabricationRules';

// Check establishment history
const history = await checkEstablishmentHistory('ABC Restaurant', 'health');
console.log(history.tag); // 'Consistent With History' or null

// Check reporter credibility
const credibility = await checkReporterCredibility('reporter@example.com');
console.log(credibility.is_credible); // true or false

// Check if under review
const underReview = await checkReporterUnderReview('reporter@example.com');
console.log(underReview.is_under_review); // true or false

// Check post-clearance pattern
const postClearance = await checkPostClearanceComplaint(
  'reporter@example.com',
  'ABC Restaurant',
  'health'
);
console.log(postClearance.is_pattern); // true or false
```

### Direct SQL Queries

```sql
-- Get all fabrication tags with analysis
SELECT calculate_fabrication_tags(
  'reporter@example.com',
  'ABC Restaurant',
  'health'
);

-- Get just the tags
SELECT get_fabrication_tags(
  'reporter@example.com',
  'ABC Restaurant',
  'health'
);

-- Check individual rules
SELECT check_establishment_history('ABC Restaurant', 'health');
SELECT check_reporter_credibility('reporter@example.com');
SELECT check_reporter_under_review('reporter@example.com');
SELECT check_post_clearance_complaint('reporter@example.com', 'ABC Restaurant', 'health');
```

## Integration with Complaint Form

### Example: ComplaintForm.jsx

```javascript
import { useEffect, useState } from 'react';
import { calculateFabricationTags } from '@/lib/complaints/fabricationRules';

export function ComplaintForm() {
  const [formData, setFormData] = useState({
    reporter_email: '',
    business_name: '',
    complaint_type: '',
  });

  const [fabricationTags, setFabricationTags] = useState([]);
  const [loading, setLoading] = useState(false);

  // Calculate tags when form data changes
  useEffect(() => {
    if (!formData.reporter_email || !formData.business_name || !formData.complaint_type) {
      setFabricationTags([]);
      return;
    }

    const calculateTags = async () => {
      setLoading(true);
      try {
        const result = await calculateFabricationTags(
          formData.reporter_email,
          formData.business_name,
          formData.complaint_type
        );
        setFabricationTags(result.tags || []);
      } catch (error) {
        console.error('Error calculating tags:', error);
      } finally {
        setLoading(false);
      }
    };

    calculateTags();
  }, [formData.reporter_email, formData.business_name, formData.complaint_type]);

  return (
    <div>
      <input
        type="email"
        placeholder="Email"
        value={formData.reporter_email}
        onChange={(e) => setFormData({ ...formData, reporter_email: e.target.value })}
      />

      <input
        type="text"
        placeholder="Business Name"
        value={formData.business_name}
        onChange={(e) => setFormData({ ...formData, business_name: e.target.value })}
      />

      <select
        value={formData.complaint_type}
        onChange={(e) => setFormData({ ...formData, complaint_type: e.target.value })}
      >
        <option value="">Select Type</option>
        <option value="health">Health</option>
        <option value="safety">Safety</option>
        <option value="labor">Labor</option>
      </select>

      {/* Display fabrication tags */}
      {fabricationTags.length > 0 && (
        <div style={{ marginTop: '16px', padding: '12px', background: '#f0f9ff', borderRadius: '8px' }}>
          <strong>Fabrication-Related Tags:</strong>
          <ul>
            {fabricationTags.map((tag) => (
              <li key={tag}>{tag}</li>
            ))}
          </ul>
        </div>
      )}

      {loading && <p>Checking history...</p>}
    </div>
  );
}
```

## Rule Details

### Rule 1: Establishment History

**Checks**: Last 3 months of inspection slips for same violation type

**Tag**: `Consistent With History`

**Example**:
- Restaurant had health violation 2 months ago
- New complaint about health issue
- Tag: `Consistent With History` ✓

### Rule 2: Reporter Credibility

**Checks**: Last 3 months of approved complaints from reporter

**Tag**: `Credible Reporter`

**Example**:
- Reporter filed 2 complaints, both approved
- New complaint from same reporter
- Tag: `Credible Reporter` ✓

### Rule 3: Reporter Under Review

**Checks**: Last 3 months of declined complaints from reporter

**Tag**: `Reporter Under Review` (if 3+ unfounded)

**Example**:
- Reporter filed 5 complaints, 4 were declined
- New complaint from same reporter
- Tag: `Reporter Under Review` ✓

### Rule 4: Post-Clearance Complaints

**Checks**: 
- Recent "No violation" inspections (30 days)
- Pattern of same complaint type after clearance (60 days, 3+ times)

**Tag**: `Post-Clearance Complaint` (if pattern detected)

**Example**:
- Restaurant cleared of health violations 2 weeks ago
- Same reporter files 3 health complaints in past 60 days
- Tag: `Post-Clearance Complaint` ✓

## Performance Considerations

### Query Optimization

All procedures use:
- **Indexed columns**: `created_at`, `reporter_email`, `business_name`, `status`
- **Date range filtering**: Limits to 3 months, 30 days, 60 days
- **STABLE functions**: Can be cached by PostgreSQL

### Recommended Indexes

```sql
-- Create if not exists
CREATE INDEX IF NOT EXISTS idx_complaints_reporter_email ON complaints(reporter_email);
CREATE INDEX IF NOT EXISTS idx_complaints_business_name ON complaints(business_name);
CREATE INDEX IF NOT EXISTS idx_complaints_created_at ON complaints(created_at);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);

CREATE INDEX IF NOT EXISTS idx_inspection_slips_business_name ON inspection_slips(business_name);
CREATE INDEX IF NOT EXISTS idx_inspection_slips_created_at ON inspection_slips(created_at);
CREATE INDEX IF NOT EXISTS idx_inspection_slips_status ON inspection_slips(status);
```

## Testing

### Test Cases

```javascript
// Test 1: Reporter with founded complaints
const result1 = await calculateFabricationTags(
  'credible@example.com',
  'ABC Restaurant',
  'health'
);
expect(result1.tags).toContain('Credible Reporter');

// Test 2: Reporter with unfounded complaints
const result2 = await calculateFabricationTags(
  'unreliable@example.com',
  'XYZ Cafe',
  'safety'
);
expect(result2.tags).toContain('Reporter Under Review');

// Test 3: Establishment with history
const result3 = await calculateFabricationTags(
  'new@example.com',
  'Problem Restaurant',
  'health'
);
expect(result3.tags).toContain('Consistent With History');

// Test 4: Post-clearance pattern
const result4 = await calculateFabricationTags(
  'persistent@example.com',
  'Cleared Restaurant',
  'health'
);
expect(result4.tags).toContain('Post-Clearance Complaint');
```

## Troubleshooting

### Issue: "Function not found" error

**Solution**: Ensure migration was deployed
```bash
supabase db push
```

### Issue: Slow queries

**Solution**: Add indexes (see Performance section)

### Issue: Incorrect results

**Solution**: Check table data
```sql
-- Verify complaints table
SELECT COUNT(*) FROM complaints WHERE reporter_email = 'test@example.com';

-- Verify inspection_slips table
SELECT COUNT(*) FROM inspection_slips WHERE business_name = 'ABC Restaurant';
```

## Next Steps

1. ✅ Deploy stored procedures
2. ✅ Add indexes for performance
3. ✅ Integrate with complaint form
4. ✅ Display tags in UI
5. ⏳ Combine with location & spam rules
6. ⏳ Calculate final authenticity tier/level
