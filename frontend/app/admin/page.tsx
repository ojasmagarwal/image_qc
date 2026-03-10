'use client';

import { useState, useEffect } from 'react';
import { useSession, SessionProvider } from 'next-auth/react';
import useSWR from 'swr';
import { API_BASE, fetcher } from '@/lib/api';
import { RefreshCw, ChevronDown, ChevronUp, CheckCircle2, Clock, AlertCircle, Users, BarChart3, ShieldAlert, Loader2 } from 'lucide-react';

// --- Types ---
type ReviewerSummary = {
    email: string;
    assigned_total: number;
    reviewed_count: number;
    pending_count: number;
};

type AssignmentSummary = {
    date: string;
    reviewers: ReviewerSummary[];
};

type PvidDetail = {
    product_variant_id: string;
    pvid_review_status: 'REVIEWED' | 'NOT_REVIEWED';
    reviewed_images: number;
    total_images: number;
    last_updated_at: string | null;
    last_updated_by: string | null;
};

type AssignmentDetails = {
    reviewer_email: string;
    pvids: PvidDetail[];
};

// --- Helpers ---
function fmtTime(ts: string | null): string {
    if (!ts) return '—';
    try {
        return new Date(ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' });
    } catch {
        return ts;
    }
}

function ProgressBar({ value, total, color }: { value: number; total: number; color: string }) {
    const pct = total === 0 ? 0 : Math.round((value / total) * 100);
    return (
        <div className="flex items-center gap-3">
            <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                <div
                    className={`h-full rounded-full transition-all duration-500 ${color}`}
                    style={{ width: `${pct}%` }}
                />
            </div>
            <span className="text-xs text-white/60 w-10 text-right">{pct}%</span>
        </div>
    );
}

// --- Reviewer Row ---
function ReviewerCard({ reviewer }: { reviewer: ReviewerSummary }) {
    const [open, setOpen] = useState(false);

    const { data: details, isLoading: detailsLoading } = useSWR<AssignmentDetails>(
        open ? `${API_BASE}/admin/assignments/details?reviewer_email=${encodeURIComponent(reviewer.email)}` : null,
        fetcher
    );

    const pct = reviewer.assigned_total === 0 ? 0 : Math.round((reviewer.reviewed_count / reviewer.assigned_total) * 100);
    const isComplete = reviewer.reviewed_count === reviewer.assigned_total && reviewer.assigned_total > 0;

    return (
        <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
            {/* Header row */}
            <button
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center gap-4 px-6 py-5 hover:bg-white/5 transition-colors text-left"
            >
                {/* Avatar */}
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${isComplete ? 'bg-emerald-500/20 text-emerald-400' : 'bg-violet-500/20 text-violet-300'}`}>
                    {reviewer.email[0].toUpperCase()}
                </div>

                {/* Email + progress */}
                <div className="flex-1 min-w-0">
                    <p className="text-white font-medium text-sm truncate">{reviewer.email}</p>
                    <div className="mt-1.5">
                        <ProgressBar value={reviewer.reviewed_count} total={reviewer.assigned_total} color={isComplete ? 'bg-emerald-500' : 'bg-violet-500'} />
                    </div>
                </div>

                {/* Stats */}
                <div className="flex gap-6 shrink-0 text-center">
                    <div>
                        <p className="text-xs text-white/40 mb-0.5">Assigned</p>
                        <p className="text-white font-semibold text-lg">{reviewer.assigned_total}</p>
                    </div>
                    <div>
                        <p className="text-xs text-emerald-400/80 mb-0.5">Reviewed</p>
                        <p className="text-emerald-400 font-semibold text-lg">{reviewer.reviewed_count}</p>
                    </div>
                    <div>
                        <p className="text-xs text-amber-400/80 mb-0.5">Pending</p>
                        <p className="text-amber-400 font-semibold text-lg">{reviewer.pending_count}</p>
                    </div>
                    <div className="flex items-center text-white/30">
                        {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </div>
                </div>
            </button>

            {/* Drilldown */}
            {open && (
                <div className="border-t border-white/10">
                    {detailsLoading ? (
                        <div className="flex items-center justify-center py-10 gap-2 text-white/40">
                            <RefreshCw size={16} className="animate-spin" />
                            <span className="text-sm">Loading PVIDs…</span>
                        </div>
                    ) : details?.pvids.length === 0 ? (
                        <p className="text-center text-white/40 text-sm py-8">No PVIDs assigned</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-white/10">
                                        <th className="text-left px-6 py-3 text-white/40 font-medium">#</th>
                                        <th className="text-left px-6 py-3 text-white/40 font-medium">PVID</th>
                                        <th className="text-left px-6 py-3 text-white/40 font-medium">Status</th>
                                        <th className="text-left px-6 py-3 text-white/40 font-medium">Images</th>
                                        <th className="text-left px-6 py-3 text-white/40 font-medium">Last Updated</th>
                                        <th className="text-left px-6 py-3 text-white/40 font-medium">By</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {details?.pvids.map((pvid, idx) => (
                                        <tr key={pvid.product_variant_id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                            <td className="px-6 py-3 text-white/30">{idx + 1}</td>
                                            <td className="px-6 py-3">
                                                <span className="font-mono text-white/80 text-xs">{pvid.product_variant_id}</span>
                                            </td>
                                            <td className="px-6 py-3">
                                                {pvid.pvid_review_status === 'REVIEWED' ? (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 text-xs font-medium">
                                                        <CheckCircle2 size={12} /> Reviewed
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-400 text-xs font-medium">
                                                        <Clock size={12} /> Pending
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-6 py-3">
                                                <span className={`text-sm ${pvid.reviewed_images === pvid.total_images && pvid.total_images > 0 ? 'text-emerald-400' : 'text-white/60'}`}>
                                                    {pvid.reviewed_images}/{pvid.total_images}
                                                </span>
                                            </td>
                                            <td className="px-6 py-3 text-white/50 text-xs">{fmtTime(pvid.last_updated_at)}</td>
                                            <td className="px-6 py-3 text-white/50 text-xs truncate max-w-[180px]">{pvid.last_updated_by ?? '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// --- Auth Gate ---
function AdminPageInner() {
    const { data: session, status } = useSession();
    const email = session?.user?.email;
    const [role, setRole] = useState<string | null>(null);
    const [roleLoading, setRoleLoading] = useState(true);

    useEffect(() => {
        if (status === 'loading') return;
        if (!email) { setRole('viewer'); setRoleLoading(false); return; }
        fetch(`${API_BASE}/me/role?email=${encodeURIComponent(email)}`)
            .then(r => r.json())
            .then(d => { setRole(d.role); setRoleLoading(false); })
            .catch(() => { setRole('viewer'); setRoleLoading(false); });
    }, [email, status]);

    if (status === 'loading' || roleLoading) {
        return (
            <div className="min-h-screen bg-[#0d0d14] flex items-center justify-center">
                <Loader2 size={32} className="animate-spin text-violet-400" />
            </div>
        );
    }

    if (role !== 'admin') {
        return (
            <div className="min-h-screen bg-[#0d0d14] flex flex-col items-center justify-center gap-4 text-white">
                <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mb-2">
                    <ShieldAlert size={32} className="text-red-400" />
                </div>
                <h1 className="text-2xl font-bold">Access Denied</h1>
                <p className="text-white/50 text-sm">This page is only accessible to administrators.</p>
                <a href="/" className="mt-4 px-5 py-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-sm transition-colors border border-white/10">
                    ← Back to Dashboard
                </a>
            </div>
        );
    }

    return <AdminDashboard />;
}

export default function AdminPage() {
    return (
        <SessionProvider>
            <AdminPageInner />
        </SessionProvider>
    );
}

// --- Main Dashboard (admin-only) ---
function AdminDashboard() {
    const {
        data: summary,
        error,
        isLoading,
        mutate,
    } = useSWR<AssignmentSummary>(`${API_BASE}/admin/assignments/today`, fetcher, {
        refreshInterval: 0,
        revalidateOnFocus: false,
    });

    const [regenerating, setRegenerating] = useState(false);

    async function handleRegenerate() {
        if (!confirm('Regenerate today\'s assignments? This will reassign all PVIDs.')) return;
        setRegenerating(true);
        try {
            await fetch(`${API_BASE}/admin/assignments/regenerate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ force: true }),
            });
            mutate();
        } catch (e) {
            alert('Regeneration failed');
        } finally {
            setRegenerating(false);
        }
    }

    const totalAssigned = summary?.reviewers.reduce((s, r) => s + r.assigned_total, 0) ?? 0;
    const totalReviewed = summary?.reviewers.reduce((s, r) => s + r.reviewed_count, 0) ?? 0;
    const totalPending = summary?.reviewers.reduce((s, r) => s + r.pending_count, 0) ?? 0;

    return (
        <div className="min-h-screen bg-[#0d0d14] text-white" style={{ fontFamily: "'Inter', sans-serif" }}>
            {/* Header */}
            <div className="border-b border-white/10 bg-white/[0.02] px-8 py-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center">
                        <BarChart3 size={16} className="text-violet-400" />
                    </div>
                    <div>
                        <h1 className="text-white font-semibold text-lg leading-none">Assignment Dashboard</h1>
                        {summary?.date && (
                            <p className="text-white/40 text-xs mt-0.5">{summary.date}</p>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => mutate()}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white text-sm transition-colors border border-white/10"
                    >
                        <RefreshCw size={14} /> Refresh
                    </button>
                    <button
                        onClick={handleRegenerate}
                        disabled={regenerating}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 text-sm transition-colors border border-red-500/20 disabled:opacity-50"
                    >
                        <RefreshCw size={14} className={regenerating ? 'animate-spin' : ''} />
                        {regenerating ? 'Regenerating…' : 'Regenerate'}
                    </button>
                    <a href="/" className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 text-sm transition-colors border border-white/10">
                        ← Dashboard
                    </a>
                </div>
            </div>

            <div className="max-w-6xl mx-auto px-8 py-8 space-y-8">

                {/* Loading */}
                {isLoading && (
                    <div className="flex items-center justify-center py-24 gap-3 text-white/40">
                        <RefreshCw size={20} className="animate-spin" />
                        <span>Loading assignments…</span>
                    </div>
                )}

                {/* Error */}
                {error && (
                    <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-2xl px-6 py-4 text-red-400">
                        <AlertCircle size={18} />
                        <span className="text-sm">{error.message}</span>
                    </div>
                )}

                {summary && (
                    <>
                        {/* Overall stats */}
                        <div className="grid grid-cols-3 gap-4">
                            {[
                                { label: 'Total Assigned', value: totalAssigned, color: 'text-white', bg: 'bg-white/5', border: 'border-white/10' },
                                { label: 'Reviewed', value: totalReviewed, color: 'text-emerald-400', bg: 'bg-emerald-500/5', border: 'border-emerald-500/20' },
                                { label: 'Pending', value: totalPending, color: 'text-amber-400', bg: 'bg-amber-500/5', border: 'border-amber-500/20' },
                            ].map(stat => (
                                <div key={stat.label} className={`${stat.bg} border ${stat.border} rounded-2xl px-6 py-5`}>
                                    <p className="text-white/40 text-xs mb-1">{stat.label}</p>
                                    <p className={`${stat.color} text-3xl font-bold`}>{stat.value}</p>
                                    {totalAssigned > 0 && stat.label !== 'Total Assigned' && (
                                        <p className="text-white/30 text-xs mt-1">
                                            {Math.round((stat.value / totalAssigned) * 100)}% of total
                                        </p>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Overall progress */}
                        <div className="bg-white/5 border border-white/10 rounded-2xl px-6 py-4">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-white/60 text-sm">Overall Progress</p>
                                <p className="text-white font-medium text-sm">
                                    {totalAssigned > 0 ? Math.round((totalReviewed / totalAssigned) * 100) : 0}%
                                </p>
                            </div>
                            <ProgressBar value={totalReviewed} total={totalAssigned} color="bg-gradient-to-r from-violet-500 to-emerald-500" />
                        </div>

                        {/* Reviewer cards */}
                        <div>
                            <div className="flex items-center gap-2 mb-4">
                                <Users size={16} className="text-white/40" />
                                <h2 className="text-white/60 text-sm font-medium uppercase tracking-wider">
                                    Reviewers ({summary.reviewers.length})
                                </h2>
                            </div>
                            <div className="space-y-3">
                                {summary.reviewers.map(r => (
                                    <ReviewerCard key={r.email} reviewer={r} />
                                ))}
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
