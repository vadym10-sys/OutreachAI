import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";

export default function SSOCallbackPage() {
  return (
    <main className="flex min-h-screen items-center justify-center overflow-x-hidden bg-slate-50 px-4 py-6">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-soft">
        <h1 className="text-xl font-bold text-ink">Completing sign in</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Securely finishing your Apple or Google authentication.</p>
        <div className="mt-5">
          <AuthenticateWithRedirectCallback />
        </div>
      </div>
    </main>
  );
}
