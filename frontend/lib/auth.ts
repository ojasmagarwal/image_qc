
import { NextAuthOptions } from "next-auth"
import GoogleProvider from "next-auth/providers/google"

export const authOptions: NextAuthOptions = {
    providers: [
        GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID || "",
            clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
        }),
    ],
    callbacks: {
        async signIn({ user }) {
            // 1. Allow zeptonow domain
            if (user.email?.endsWith("@zeptonow.com")) {
                return true
            }

            // 2. Allow if user exists in Firestore as reviewer/admin
            if (user.email) {
                try {
                    const apiBase = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8000';
                    const res = await fetch(`${apiBase}/me/role?email=${user.email}`);
                    if (res.ok) {
                        const data = await res.json();
                        console.log(`[Auth] Role check for ${user.email}:`, data);

                        // Allow if:
                        // 1. Explicitly exists in Firestore (as viewer, reviewer, etc.)
                        // 2. Has a privileged role (reviewer/admin) even if exists flag logic is flaky
                        if (data.exists || ['reviewer', 'admin'].includes(data.role)) {
                            return true;
                        }
                    } else {
                        console.error(`[Auth] Role check failed: ${res.status}`);
                    }
                } catch (e) {
                    console.error("Error checking user role", e);
                }
            }

            return false
        },
    },
}
