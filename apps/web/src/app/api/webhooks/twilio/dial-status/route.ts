import { createDomainService } from "@communication-canoe/database";

export async function POST(request: Request) {
  const form = await request.formData();
  const callSid = form.get("CallSid")?.toString();
  const dialStatus = form.get("DialCallStatus")?.toString();

  if (callSid && dialStatus === "no-answer") {
    const domain = createDomainService();
    // Outcome updates handled by bridge; webhook provides Twilio fallback TwiML
    void domain;
  }

  return new Response(
    `<Response><Say>Sorry, no one is available. Please leave a message after the tone.</Say></Response>`,
    { headers: { "Content-Type": "text/xml" } },
  );
}
