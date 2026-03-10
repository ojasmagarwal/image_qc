import { NextResponse } from 'next/server';

// Called by Vercel Cron at 11:30 AM IST (06:00 UTC) every day.
// Triggers today's PVID assignment generation on the backend.
export async function GET(request: Request) {
    // Verify the request is from Vercel Cron when CRON_SECRET is configured.
    // If the env var is not set yet (e.g. first deployment), skip the check.
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
        const authHeader = request.headers.get('authorization');
        if (authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
    }

    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
    if (!apiBase) {
        return NextResponse.json({ error: 'API_BASE not configured' }, { status: 500 });
    }

    try {
        const res = await fetch(`${apiBase}/admin/assignments/regenerate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // force: false — only generates if no assignment doc exists for today yet
            // (idempotent: won't overwrite an admin's manual regeneration)
            body: JSON.stringify({ force: false }),
        });

        if (!res.ok) {
            const text = await res.text();
            console.error('[cron/assign] Backend error:', res.status, text);
            return NextResponse.json({ error: 'Backend failed', detail: text }, { status: 502 });
        }

        const data = await res.json();
        console.log('[cron/assign] Assignment generation succeeded:', data);
        return NextResponse.json({ ok: true, result: data });
    } catch (err) {
        console.error('[cron/assign] Fetch error:', err);
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
