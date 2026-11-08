import Link from "next/link";

// Public self-signup is closed. New businesses are created by the platform
// operator from the Platform Command Center, and the owner receives a
// one-time invite link to set up their login.
export default function SignupClosedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-sand-50 px-5">
      <div className="w-full max-w-md rounded-xl2 border border-depth-200/60 bg-white p-6 text-center shadow-soft">
        <h1 className="font-display text-xl font-bold text-depth-900">Accounts are by invitation</h1>
        <p className="mt-2 text-sm text-depth-600">
          New business accounts are set up by our team. If you would like to use the system for your
          business, please contact us and we will send you an invitation link.
        </p>
        <p className="mt-2 text-sm text-depth-600">
          Already received an invitation? Open the link you were sent to finish setting up your login.
        </p>
        <Link
          href="/login"
          className="tap-target mt-6 inline-flex w-full items-center justify-center rounded-xl2 bg-flow-500 font-display font-semibold text-depth-950"
        >
          Go to sign in
        </Link>
      </div>
    </main>
  );
}
