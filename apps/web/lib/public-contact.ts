import { ownerEmail } from "@/lib/env";

export const publicSupportEmail = ownerEmail;

export const requiredOwnerInput = [
  "Confirm the legal entity name for Privacy, Terms and invoices.",
  "Confirm the registered business address and governing law for Terms.",
  "Confirm dedicated support, privacy and security email aliases if different from the current owner email.",
  "Confirm whether a formal DPA, subprocessors page, SLA, incident-response policy or compliance certifications should be published.",
] as const;

