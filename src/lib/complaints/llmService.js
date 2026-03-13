/**
 * LLM Service - AI-powered complaint analysis
 * Provides risk assessment and decision support using LLM API
 * 
 * Supports: OpenAI, Claude, Gemini (configurable)
 */

const LLM_CONFIG = {
  provider: import.meta.env.VITE_LLM_PROVIDER || 'openai', // 'openai' | 'claude' | 'gemini'
  apiKey: import.meta.env.VITE_LLM_API_KEY,
  model: import.meta.env.VITE_LLM_MODEL || 'gpt-3.5-turbo',
  timeout: 30000, // 30 seconds
};

/**
 * Build complaint analysis prompt
 */
function buildAnalysisPrompt(complaint) {
  const evidenceCount = Array.isArray(complaint.image_urls) ? complaint.image_urls.length : 0;
  const locationVerified = complaint.tags?.some(t => 
    String(t || '').toLowerCase().includes('location verified')
  ) ? 'Yes' : 'No';

  return `You are a compliance officer analyzing a business complaint for risk assessment.

COMPLAINT DETAILS:
- Business Name: ${complaint.business_name || 'N/A'}
- Business Address: ${complaint.business_address || 'N/A'}
- Reporter Email: ${complaint.reporter_email || 'N/A'}
- Complaint Description: ${complaint.complaint_description || 'N/A'}
- Evidence Photos: ${evidenceCount}
- Location Verified: ${locationVerified}
- Authenticity Score: ${complaint.authenticity_level || 0}/100

TASK:
Analyze this complaint and provide:
1. RISK_LEVEL: Low, Medium, or High
2. KEY_CONCERNS: 2-3 specific concerns (bullet points)
3. RECOMMENDED_ACTION: Approve, Decline, or Review
4. REASONING: Brief explanation (1-2 sentences)

Format your response as JSON:
{
  "risk_level": "Low|Medium|High",
  "key_concerns": ["concern 1", "concern 2", "concern 3"],
  "recommended_action": "Approve|Decline|Review",
  "reasoning": "explanation"
}

Be concise and objective. Focus on compliance risk, not personal opinion.`;
}

/**
 * Call OpenAI API
 */
async function callOpenAI(prompt) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LLM_CONFIG.apiKey}`,
    },
    body: JSON.stringify({
      model: LLM_CONFIG.model,
      messages: [
        {
          role: 'system',
          content: 'You are a compliance officer analyzing business complaints. Respond only with valid JSON.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3, // Low temperature for consistent, objective analysis
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`OpenAI API error: ${error.error?.message || 'Unknown error'}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('No response from OpenAI');

  return JSON.parse(content);
}

/**
 * Call Claude API (Anthropic)
 */
async function callClaude(prompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': LLM_CONFIG.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: LLM_CONFIG.model || 'claude-3-haiku-20240307',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      system: 'You are a compliance officer analyzing business complaints. Respond only with valid JSON.',
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Claude API error: ${error.error?.message || 'Unknown error'}`);
  }

  const data = await response.json();
  const content = data.content?.[0]?.text;
  if (!content) throw new Error('No response from Claude');

  return JSON.parse(content);
}

/**
 * Call Google Gemini API
 */
async function callGemini(prompt) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${LLM_CONFIG.model || 'gemini-pro'}:generateContent?key=${LLM_CONFIG.apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 500,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Gemini API error: ${error.error?.message || 'Unknown error'}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error('No response from Gemini');

  return JSON.parse(content);
}

/**
 * Main analysis function - routes to appropriate LLM
 */
export async function analyzeComplaintWithLLM(complaint) {
  // Validate configuration
  if (!LLM_CONFIG.apiKey) {
    throw new Error('LLM API key not configured. Set VITE_LLM_API_KEY environment variable in .env file.');
  }

  if (!complaint) {
    throw new Error('Complaint data is required');
  }

  const prompt = buildAnalysisPrompt(complaint);

  try {
    let result;

    switch (LLM_CONFIG.provider.toLowerCase()) {
      case 'openai':
        result = await callOpenAI(prompt);
        break;
      case 'claude':
        result = await callClaude(prompt);
        break;
      case 'gemini':
        result = await callGemini(prompt);
        break;
      default:
        throw new Error(`Unknown LLM provider: ${LLM_CONFIG.provider}`);
    }

    // Validate response structure
    if (!result.risk_level || !result.recommended_action) {
      throw new Error('Invalid LLM response format');
    }

    return {
      success: true,
      data: {
        riskLevel: result.risk_level,
        keyConcerns: Array.isArray(result.key_concerns) ? result.key_concerns : [],
        recommendedAction: result.recommended_action,
        reasoning: result.reasoning || '',
      },
    };
  } catch (error) {
    console.error('LLM analysis error:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Format LLM result for display
 */
export function formatLLMResult(result) {
  if (!result.success) {
    return {
      error: result.error,
      display: null,
    };
  }

  const { riskLevel, keyConcerns, recommendedAction, reasoning } = result.data;

  const riskColor = {
    'Low': '#22c55e',
    'Medium': '#f59e0b',
    'High': '#ef4444',
  }[riskLevel] || '#94a3b8';

  const actionColor = {
    'Approve': '#22c55e',
    'Decline': '#ef4444',
    'Review': '#f59e0b',
  }[recommendedAction] || '#94a3b8';

  return {
    error: null,
    display: {
      riskLevel,
      riskColor,
      keyConcerns,
      recommendedAction,
      actionColor,
      reasoning,
    },
  };
}

/**
 * Check if LLM is configured
 */
export function isLLMConfigured() {
  return !!LLM_CONFIG.apiKey;
}

/**
 * Get current LLM provider
 */
export function getLLMProvider() {
  return LLM_CONFIG.provider;
}
