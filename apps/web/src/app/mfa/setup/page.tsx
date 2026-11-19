import QRCode from "qrcode";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/sign-out";
import { GateShell } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import { generateTotpSecret, otpauthUri } from "@/lib/security/totp";
import { EnrolForm } from "./enrol-form";

export const metadata = { title: "Set up two-step verification" };

export default async function MfaSetupPage() {
  const s = await requireSession("mfa");
  if (s.user.mfaEnabledAt) redirect(s.mfaVerified ? "/" : "/mfa");

  // Reuse a pending (unconfirmed) secret so reloading the page keeps the same QR code.
  const user = await prisma.user.findUniqueOrThrow({ where: { id: s.user.id }, select: { id: true, mfaSecretEnc: true } });
  let secret: string;
  if (user.mfaSecretEnc) {
    secret = decryptSecret(user.mfaSecretEnc, user.id);
  } else {
    secret = generateTotpSecret();
    await prisma.user.update({ where: { id: user.id }, data: { mfaSecretEnc: encryptSecret(secret, user.id) } });
  }
  const qr = await QRCode.toDataURL(otpauthUri(secret, s.user.email), { margin: 1, width: 200 });

  return (
    <GateShell title="Set up two-step verification">
      <div className="space-y-4 text-sm">
        <p>Two-step verification is required for every account. Scan this code with an authenticator app (for example Microsoft Authenticator or Google Authenticator), then enter the 6-digit code it shows.</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL, nothing to optimise */}
        <img src={qr} alt="QR code for your authenticator app" width={200} height={200} className="mx-auto rounded bg-white p-2" />
        <details className="text-xs">
          <summary className="cursor-pointer">Can&apos;t scan? Enter the key manually</summary>
          <code className="mt-2 block break-all rounded bg-black/5 p-2 font-mono dark:bg-white/10">{secret.match(/.{1,4}/g)?.join(" ")}</code>
        </details>
        <EnrolForm />
        <SignOutButton />
      </div>
    </GateShell>
  );
}
