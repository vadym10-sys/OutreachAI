import { isClerkAPIResponseError } from '@clerk/nextjs/errors';

export const genericPasswordResetRequestMessage = 'If this email exists, we sent password reset instructions.';
export const passwordResetUnavailableMessage = 'Password reset is temporarily unavailable. Please try again shortly or contact support.';
export const passwordResetRejectedCodeMessage = 'The reset code or new password could not be accepted. Request a new email if the code expired.';

export function clerkPasswordResetErrorCode(error: unknown) {
  if (!isClerkAPIResponseError(error)) return null;
  return error.errors.map((item) => item.code).filter(Boolean).join(',') || null;
}

export function passwordResetRequestMessage(error: unknown) {
  const code = clerkPasswordResetErrorCode(error);
  if (!code) return passwordResetUnavailableMessage;

  if (
    code.includes('form_identifier_not_found') ||
    code.includes('identifier_not_found') ||
    code.includes('user_not_found')
  ) {
    return genericPasswordResetRequestMessage;
  }

  return passwordResetUnavailableMessage;
}
