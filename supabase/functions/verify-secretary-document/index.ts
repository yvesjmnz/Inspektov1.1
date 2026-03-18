import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OCR_SPACE_API_URL = "https://api.ocr.space/parse/image";
const OCR_SPACE_API_KEY = Deno.env.get("OCR_SPACE_API_KEY");

interface VerificationRequest {
  missionOrderId: string;
  fileBase64: string;
  fileName: string;
}

interface VerificationResult {
  success: boolean;
  matchScore: number;
  details: {
    businessNameFound: boolean;
    inspectorNamesFound: string[];
    missionOrderMarkerFound: boolean;
    extractedKeywords: string[];
  };
  warnings: string[];
  recommendations: string[];
  error?: string;
}

/**
 * Extract text from document using OCR Space API
 */
async function extractTextFromDocument(
  fileBase64: string,
  fileName: string
): Promise<string> {
  console.log(" Starting OCR");

  const apiKey = Deno.env.get("OCR_SPACE_API_KEY");

  const formData = new FormData();
  formData.append("apikey", apiKey!);

  // ✅ ONLY THIS (no file, no filename)
  formData.append(
    "base64Image",
    `data:application/pdf;base64,${fileBase64}`
  );

  formData.append("language", "eng");
  formData.append("isOverlayRequired", "false");

  const response = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(
      `OCR API error: ${response.status} ${response.statusText}`
    );
  }

  const result = await response.json();

  if (result.IsErroredOnProcessing) {
    throw new Error(
      `OCR failed: ${JSON.stringify(result.ErrorMessage)}`
    );
  }

  const text =
    result?.ParsedResults
      ?.map((r: any) => r.ParsedText)
      .join(" ") || "";

  console.log(" OCR text length:", text.length);

  return text;
}

/**
 * Verify document matches mission order details
 */
function verifyDocumentIdentity(
  extractedText: string,
  businessName: string,
  inspectorNames: string[]
): VerificationResult {
  console.log(" Starting document identity verification");

  const normalizedText = extractedText.toUpperCase();

  const result: VerificationResult = {
    success: false,
    matchScore: 0,
    details: {
      businessNameFound: false,
      inspectorNamesFound: [],
      missionOrderMarkerFound: false,
      extractedKeywords: [],
    },
    warnings: [],
    recommendations: [],
  };

  // Check for mission order document markers
  const missionOrderMarkers = [
    "MISSION ORDER",
    "FIELD INSPECTOR",
    "BUSINESS ESTABLISHMENT",
    "INSPECTION",
    "SECRETARY",
  ];

  let markerCount = 0;
  for (const marker of missionOrderMarkers) {
    if (normalizedText.includes(marker)) {
      markerCount++;
      result.details.extractedKeywords.push(marker);
    }
  }

  result.details.missionOrderMarkerFound = markerCount >= 3;
  console.log(
    ` Found ${markerCount}/${missionOrderMarkers.length} mission order markers`
  );

  // Check for business name
  if (businessName) {
    const normalizedBusinessName = businessName.toUpperCase();
    const businessNameVariations = [
      normalizedBusinessName,
      normalizedBusinessName.replace(/\s+/g, ""),
      normalizedBusinessName.split(" ")[0],
    ];

    for (const variation of businessNameVariations) {
      if (variation.length > 2 && normalizedText.includes(variation)) {
        result.details.businessNameFound = true;
        console.log(` Business name found: "${businessName}"`);
        break;
      }
    }

    if (!result.details.businessNameFound) {
      result.warnings.push(
        `Business name "${businessName}" not found in document. Document may not match this mission order.`
      );
      console.warn(" Business name not found in document");
    }
  }

  // Check for inspector names
  if (inspectorNames && inspectorNames.length > 0) {
    for (const inspectorName of inspectorNames) {
      const normalizedInspectorName = inspectorName.toUpperCase();
      const nameVariations = [
        normalizedInspectorName,
        normalizedInspectorName.replace(/\s+/g, ""),
        ...normalizedInspectorName.split(" "),
      ];

      for (const variation of nameVariations) {
        if (variation.length > 2 && normalizedText.includes(variation)) {
          result.details.inspectorNamesFound.push(inspectorName);
          console.log(` Inspector name found: "${inspectorName}"`);
          break;
        }
      }
    }

    if (result.details.inspectorNamesFound.length === 0) {
      result.warnings.push(
        `No assigned inspector names found in document. Expected: ${inspectorNames.join(", ")}`
      );
      console.warn(" No inspector names found in document");
    }
  }

  // Calculate match score (0-100)
  let score = 0;

  if (result.details.missionOrderMarkerFound) {
    score += 10;
  }

  if (result.details.businessNameFound) {
    score += 70;
  }

  if (inspectorNames.length > 0) {
    score += 20
  } else if (result.details.inspectorNamesFound.length > 0) {
    score += 10;
  }

  result.matchScore = score;
  result.success = score >= 80;

  // Generate recommendations
  if (score < 60) {
    result.recommendations.push(
      "Document verification score is below threshold. Please verify the uploaded document matches the mission order."
    );
  }

  if (!result.details.businessNameFound) {
    result.recommendations.push(
      "Ensure the document clearly shows the business name from the mission order."
    );
  }

  if (result.details.inspectorNamesFound.length < inspectorNames.length) {
    result.recommendations.push(
      "Ensure the document includes all assigned inspector names."
    );
  }

  console.log(
    " Document verification complete. Score:",
    score,
    "Valid:",
    result.success
  );

  return result;
}

serve(async (req) => {
  // CORS headers - allow Supabase client headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  try {
    console.log(" Verify secretary document request received");

    const { missionOrderId, fileBase64, fileName } =
      (await req.json()) as VerificationRequest;

    if (!missionOrderId || !fileBase64 || !fileName) {
      throw new Error("Missing required parameters: missionOrderId, fileBase64, fileName");
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Fetch mission order details
    console.log(" Fetching mission order details:", missionOrderId);

    const { data: missionOrder, error: moError } = await supabase
      .from("mission_orders")
      .select("id, complaint_id")
      .eq("id", missionOrderId)
      .single();

    if (moError || !missionOrder) {
      throw new Error(`Failed to fetch mission order: ${moError?.message}`);
    }

    // 2. Fetch complaint details (business name)
    console.log(" Fetching complaint details");

    const { data: complaint, error: complaintError } = await supabase
      .from("complaints")
      .select("business_name")
      .eq("id", missionOrder.complaint_id)
      .single();

    if (complaintError || !complaint) {
      throw new Error(`Failed to fetch complaint: ${complaintError?.message}`);
    }

    // 3. Fetch assigned inspectors
    console.log(" Fetching assigned inspectors");

    const { data: assignments, error: assignmentError } = await supabase
      .from("mission_order_assignments")
      .select("inspector_id")
      .eq("mission_order_id", missionOrderId);

    if (assignmentError) {
      throw new Error(`Failed to fetch assignments: ${assignmentError.message}`);
    }

    const inspectorIds = (assignments || [])
      .map((a) => a.inspector_id)
      .filter(Boolean);

    // 4. Fetch inspector names
    let inspectorNames: string[] = [];
    if (inspectorIds.length > 0) {
      console.log(" Fetching inspector profiles");

      const { data: profiles, error: profileError } = await supabase
        .from("profiles")
        .select("full_name, first_name, middle_name, last_name")
        .in("id", inspectorIds);

      if (profileError) {
        throw new Error(`Failed to fetch profiles: ${profileError.message}`);
      }

      inspectorNames = (profiles || []).map((p) =>
        p.full_name ||
        [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(" ")
      );
    }

    console.log(
      "a Mission order details retrieved. Business:",
      complaint.business_name,
      "Inspectors:",
      inspectorNames
    );

    // 5. Extract text from document
    const extractedText = await extractTextFromDocument(fileBase64, fileName);

    // 6. Verify document identity
    const verificationResult = verifyDocumentIdentity(
      extractedText,
      complaint.business_name,
      inspectorNames
    );

    console.log(" Document verification result:", verificationResult);

    return new Response(JSON.stringify(verificationResult), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      status: 200,
    });
  } catch (error) {
    console.error(" Error in verify-secretary-document:", error);

    const errorResponse: VerificationResult = {
      success: false,
      matchScore: 0,
      details: {
        businessNameFound: false,
        inspectorNamesFound: [],
        missionOrderMarkerFound: false,
        extractedKeywords: [],
      },
      warnings: [],
      recommendations: [],
      error: error.message,
    };

    return new Response(JSON.stringify(errorResponse), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      status: 400,
    });
  }
});
