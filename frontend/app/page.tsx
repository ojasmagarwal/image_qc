'use client';

import { useState, useEffect } from 'react';
import { useSession, signIn, signOut, SessionProvider } from "next-auth/react";
import useSWR from 'swr';
import { Loader2, X, ChevronLeft, ChevronRight, LogOut, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { API_BASE, fetcher } from '@/lib/api';
import { MultiSelectDropdown, SearchableBrandDropdown } from '@/components/Filters';

// --- Types ---
type ImageIssues = {
    image_blur: boolean;
    cropped_image: boolean;
    mrp_present_in_image: boolean;
    image_quality: boolean;
    aspect_ratio: boolean;
};

type ImageItem = {
    image_index: number;
    image_url: string;
    aspect_ratio_value: string | null;
    meta_3x4: string | null;
    hide_padding: boolean | null;
    dpi: number | null;
    white_bg: boolean | null;
    review_status: string;
    issues: ImageIssues;
    updated_by: string | null;
    updated_at: string | null;
};

type PvidItem = {
    product_variant_id: string;
    brand_name: string;
    product_name: string;
    category_name: string;
    subcategory_name: string;
    l3_category_name: string;
    created_date_bucket_label: string | null;
    pvid_review_status: string;
    images: ImageItem[];
};

type ImagesResponse = {
    items: PvidItem[];
    page: number;
    page_size: number;
    has_more: boolean;
};

type FilterOptions = {
    categories: string[];
    brands: string[];
    created_date_buckets: string[];
};

// --- Config ---
const useAuth = () => {
    const { data: session, status } = useSession();
    const [role, setRole] = useState<string>('viewer');
    const email = session?.user?.email || null;
    const loading = status === "loading";

    useEffect(() => {
        if (email) {
            fetch(`${API_BASE}/me/role?email=${email}`)
                .then(r => r.json())
                .then(d => setRole(d.role))
                .catch(() => setRole('viewer'));
        }
    }, [email]);

    return {
        email,
        role,
        loading,
        login: () => signIn('google'),
        logout: () => signOut(),
        canWrite: ['reviewer', 'admin'].includes(role)
    };
};

// --- Image Modal Component ---
function ImageModal({
    pvidItem,
    selectedImageIndex,
    onClose,
    onImageSelect,
    onToggleStatus,
    onToggleIssue,
    canWrite,
    email,
}: {
    pvidItem: PvidItem;
    selectedImageIndex: number;
    onClose: () => void;
    onImageSelect: (index: number) => void;
    onToggleStatus: (pvid: string, imageIndex: number) => Promise<void>;
    onToggleIssue: (pvid: string, imageIndex: number, issueKey: string, value: boolean) => Promise<void>;
    canWrite: boolean;
    email: string | null;
}) {
    const selectedImage = pvidItem.images.find(img => img.image_index === selectedImageIndex) || pvidItem.images[0];

    // ... (rest of modal logic is same, hook it up properly) ...
    // To save tokens, I'm assuming the existing Modal code is fine, 
    // but I must provide the full component to replace the file content correctly
    // or I can match specific chunks. 
    // The previous view showed ImageModal lines 85-271. I will retain that structure.

    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [onClose]);

    if (!selectedImage) return null;

    const issueLabels: Record<string, string> = {
        image_blur: 'Image Blur',
        cropped_image: 'Cropped Image',
        mrp_present_in_image: 'MRP Present in Image',
        image_quality: 'Image Quality',
        aspect_ratio: 'Aspect Ratio',
    };

    return (
        <div
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Modal Header */}
                <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center z-10">
                    <div>
                        <h2 className="text-xl font-bold">{pvidItem.product_name}</h2>
                        <div className="text-sm text-gray-500 font-mono mt-1">
                            {pvidItem.product_variant_id} • {pvidItem.brand_name}
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                        <X size={24} />
                    </button>
                </div>

                {/* Enlarged Image */}
                <div className="w-full h-96 bg-gray-100 flex items-center justify-center border-b">
                    <img
                        src={selectedImage.image_url}
                        alt={pvidItem.product_name}
                        className="max-h-full max-w-full object-contain p-4"
                    />
                </div>

                {/* Image Attributes */}
                <div className="p-6 space-y-4">
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm text-gray-600 bg-gray-50 p-3 rounded">
                        <div>
                            <span className="block text-xs font-semibold text-gray-400 uppercase">Aspect Ratio</span>
                            {selectedImage.aspect_ratio_value || "-"}
                        </div>
                        <div>
                            <span className="block text-xs font-semibold text-gray-400 uppercase">DPI</span>
                            {selectedImage.dpi ?? "-"}
                        </div>
                        <div>
                            <span className="block text-xs font-semibold text-gray-400 uppercase">Hide Padding</span>
                            {selectedImage.hide_padding === null || selectedImage.hide_padding === undefined
                                ? "-"
                                : selectedImage.hide_padding
                                    ? "Yes"
                                    : "No"}
                        </div>
                        <div>
                            <span className="block text-xs font-semibold text-gray-400 uppercase">White BG</span>
                            {selectedImage.white_bg === null || selectedImage.white_bg === undefined
                                ? "-"
                                : selectedImage.white_bg
                                    ? "Yes"
                                    : "No"}
                        </div>
                        <div className="lg:col-span-4">
                            <span className="block text-xs font-semibold text-gray-400 uppercase">Meta 3x4</span>
                            {selectedImage.meta_3x4 || "-"}
                        </div>
                    </div>

                    {/* Review Status Toggle */}
                    <div className="flex items-center gap-4 pt-4 border-t">
                        <span className="text-sm font-semibold text-gray-700">Review Status:</span>
                        <button
                            onClick={() => onToggleStatus(pvidItem.product_variant_id, selectedImage.image_index)}
                            disabled={!canWrite}
                            className={cn(
                                "text-sm font-bold px-6 py-2 rounded-full transition-all border",
                                !canWrite && "opacity-50 cursor-not-allowed",
                                selectedImage.review_status === 'REVIEWED'
                                    ? "bg-green-100 text-green-700 border-green-200 hover:bg-green-200"
                                    : "bg-red-100 text-red-700 border-red-200 hover:bg-red-200"
                            )}
                        >
                            {selectedImage.review_status === 'REVIEWED' ? "REVIEWED" : "NOT REVIEWED"}
                        </button>
                    </div>

                    {/* Issue Toggles */}
                    <div className="pt-4 border-t">
                        <h3 className="text-sm font-semibold text-gray-700 mb-3">Issues</h3>
                        <div className="flex flex-wrap gap-2">
                            {Object.entries(issueLabels).map(([key, label]) => (
                                <button
                                    key={key}
                                    onClick={() =>
                                        onToggleIssue(
                                            pvidItem.product_variant_id,
                                            selectedImage.image_index,
                                            key,
                                            !selectedImage.issues[key as keyof ImageIssues]
                                        )
                                    }
                                    disabled={!canWrite}
                                    className={cn(
                                        "px-4 py-2 rounded-full text-sm font-medium transition-all border",
                                        !canWrite && "opacity-50 cursor-not-allowed",
                                        selectedImage.issues[key as keyof ImageIssues]
                                            ? "bg-red-100 text-red-700 border-red-300 hover:bg-red-200"
                                            : "bg-gray-100 text-gray-600 border-gray-300 hover:bg-gray-200"
                                    )}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Thumbnail Strip */}
                    <div className="pt-4 border-t">
                        <div className="text-xs font-semibold text-gray-400 uppercase mb-2">All Images</div>
                        <div className="flex gap-3 overflow-x-auto py-2">
                            {pvidItem.images.map(img => (
                                <button
                                    key={img.image_index}
                                    onClick={() => onImageSelect(img.image_index)}
                                    className={cn(
                                        "relative border rounded-md bg-gray-50 flex-shrink-0",
                                        "w-20 h-20 flex items-center justify-center",
                                        selectedImage.image_index === img.image_index
                                            ? "ring-2 ring-blue-500 border-blue-400"
                                            : "hover:border-blue-300"
                                    )}
                                >
                                    <img
                                        src={img.image_url}
                                        alt={pvidItem.product_name}
                                        className="max-w-full max-h-full object-contain p-1"
                                    />
                                    {img.review_status === 'REVIEWED' && (
                                        <div className="absolute top-1 right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function Page() {
    return (
        <SessionProvider>
            <Dashboard />
        </SessionProvider>
    );
}

function Dashboard() {
    const { email, role, loading: authLoading, login, logout, canWrite } = useAuth();

    // Page specific state
    const [page, setPage] = useState(1);

    type FilterState = {
        status: string;
        brand: string;
        l1: string[];
        bucket: string;
        pvid: string;
    }

    const [filters, setFilters] = useState<FilterState>({
        status: 'All',
        brand: 'All',
        l1: ['All'],
        bucket: 'All',
        pvid: ''
    });

    // Modal state
    const [modalPvid, setModalPvid] = useState<string | null>(null);
    const [modalImageIndex, setModalImageIndex] = useState<number | null>(null);

    // Fetch Filter Options
    const { data: filterOptions } = useSWR<FilterOptions>(`${API_BASE}/filters`, fetcher);

    // Construct Query Params
    const buildQuery = () => {
        const p = new URLSearchParams();
        p.append('page', page.toString());
        if (filters.status && filters.status !== 'All') p.append('status', filters.status);
        if (filters.brand && filters.brand !== 'All') p.append('brand', filters.brand);

        // Handle array for category_name
        if (filters.l1 && !filters.l1.includes('All')) {
            filters.l1.forEach(c => p.append('category_name', c));
        }

        if (filters.bucket && filters.bucket !== 'All') p.append('created_bucket', filters.bucket);
        if (filters.pvid) p.append('product_variant_id', filters.pvid);

        return p.toString();
    };

    const { data: imagesData, error, isLoading, mutate } = useSWR<ImagesResponse>(
        email ? `${API_BASE}/images?${buildQuery()}` : null,
        fetcher,
        {
            refreshInterval: 5000,
            dedupingInterval: 0,
            revalidateOnFocus: true,
            keepPreviousData: true
        }
    );

    // Handlers
    const updateFilter = (key: keyof FilterState, value: any) => {
        setFilters(prev => ({ ...prev, [key]: value }));
        setPage(1);
    };

    const handleToggleStatus = async (pvid: string, imageIndex: number) => {
        if (!canWrite || !email) return;

        try {
            const res = await fetch(`${API_BASE}/qc/toggle`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    product_variant_id: pvid,
                    image_index: imageIndex,
                    actor: email
                })
            });
            if (!res.ok) throw new Error('Failed');

            // Revalidate immediately to get fresh state from backend
            mutate();
        } catch (e) {
            alert("Failed to toggle status");
        }
    };

    const handleToggleIssue = async (pvid: string, imageIndex: number, issueKey: string, value: boolean) => {
        if (!canWrite || !email) return;

        try {
            const res = await fetch(`${API_BASE}/qc/issues/toggle`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    product_variant_id: pvid,
                    image_index: imageIndex,
                    actor: email,
                    issue_key: issueKey,
                    value: value
                })
            });
            if (!res.ok) throw new Error('Failed');
            mutate();
        } catch (e) {
            alert("Failed to toggle issue");
        }
    };

    const openModal = (pvid: string, imageIndex: number) => {
        setModalPvid(pvid);
        setModalImageIndex(imageIndex);
    };

    const closeModal = () => {
        setModalPvid(null);
        setModalImageIndex(null);
    };

    if (authLoading) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-blue-500" /></div>;

    if (!email) {
        return (
            <div className="flex h-screen items-center justify-center bg-gray-50">
                <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-md text-center">
                    <h1 className="text-2xl font-bold mb-6">Image QC Login</h1>
                    <button
                        onClick={() => login()}
                        className="w-full bg-blue-600 text-white p-3 rounded hover:bg-blue-700 font-medium transition-colors flex items-center justify-center gap-2"
                    >
                        Sign in with Google
                    </button>
                    <p className="mt-4 text-sm text-gray-500">
                        Restricted to @zeptonow.com
                    </p>
                </div>
            </div>
        );
    }

    const modalPvidItem = modalPvid && imagesData?.items.find(item => item.product_variant_id === modalPvid);

    return (
        <div className="min-h-screen flex flex-col bg-gray-50">
            <header className="bg-white border-b px-6 py-4 flex justify-between items-center sticky top-0 z-10 shrink-0 shadow-sm">
                <div>
                    <h1 className="text-xl font-bold">Image QC</h1>
                    <div className="text-sm text-gray-500">
                        {email}
                        <span className={cn(
                            "ml-2 px-2 py-0.5 rounded text-xs uppercase font-bold",
                            canWrite ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                        )}>
                            {canWrite ? role : `${role} (Read Only)`}
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    {isLoading && <Loader2 className="animate-spin text-gray-400" />}
                    <button onClick={logout} className="text-gray-500 hover:text-red-600" title="Logout"><LogOut size={20} /></button>
                </div>
            </header>

            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar */}
                <aside className="w-72 bg-white border-r p-4 overflow-y-auto hidden md:block shrink-0">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="font-bold">Filters</h2>
                        <button
                            onClick={() => { setFilters({ status: 'All', brand: 'All', l1: ['All'], bucket: 'All', pvid: '' }); setPage(1); }}
                            className="text-xs text-blue-600 hover:underline"
                        >
                            Clear
                        </button>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="text-xs font-semibold text-gray-500 uppercase">Variant ID</label>
                            <input
                                className="w-full mt-1 p-2 text-sm border rounded bg-gray-50"
                                placeholder="Product Variant ID"
                                value={filters.pvid}
                                onChange={e => updateFilter('pvid', e.target.value)}
                            />
                        </div>

                        <div>
                            <label className="text-xs font-semibold text-gray-500 uppercase">Status</label>
                            <select
                                className="w-full mt-1 p-2 text-sm border rounded bg-gray-50"
                                value={filters.status}
                                onChange={e => updateFilter('status', e.target.value)}
                            >
                                <option value="All">All</option>
                                <option value="REVIEWED">Reviewed</option>
                                <option value="NOT_REVIEWED">Not Reviewed</option>
                            </select>
                        </div>

                        <div>
                            <label className="text-xs font-semibold text-gray-500 uppercase">Created bucket</label>
                            <select
                                className="w-full mt-1 p-2 text-sm border rounded bg-gray-50"
                                value={filters.bucket}
                                onChange={e => updateFilter('bucket', e.target.value)}
                            >
                                {filterOptions?.created_date_buckets ? (
                                    filterOptions.created_date_buckets.map(d => <option key={d} value={d}>{d}</option>)
                                ) : <option>Loading...</option>}
                            </select>
                        </div>

                        {/* Searchable Brand Dropdown */}
                        <SearchableBrandDropdown
                            label="Brand"
                            options={filterOptions?.brands || ['All']}
                            selected={filters.brand}
                            onChange={(val) => updateFilter('brand', val)}
                        />

                        {/* Multi-Select Category */}
                        <MultiSelectDropdown
                            label="Category (L1)"
                            options={filterOptions?.categories || ['All']}
                            selected={filters.l1}
                            onChange={(val) => updateFilter('l1', val)}
                        />
                    </div>
                </aside>

                {/* Main Content */}
                <main className="flex-1 overflow-y-auto p-6 relative bg-gray-50">
                    {error && (
                        <div className="absolute top-4 left-4 right-4 bg-red-50 border border-red-200 text-red-700 p-4 rounded flex items-center gap-2 z-20">
                            <AlertCircle size={20} />
                            <span>{error.message || "Failed to load images"}</span>
                        </div>
                    )}

                    {/* Compact Row Strips per PVID */}
                    <div className="grid grid-cols-1 gap-4 pb-20 pt-2">
                        {!error && imagesData?.items.map((item) => (
                            <div
                                key={item.product_variant_id}
                                className="bg-white border rounded-lg shadow-sm hover:shadow-md transition-shadow p-4"
                            >
                                <div className="flex gap-4">
                                    {/* Left: Horizontal Image Strip */}
                                    <div className="flex-shrink-0">
                                        <div className="flex gap-2 overflow-x-auto scrollbar-hide" style={{ width: '400px', maxWidth: '100%' }}>
                                            {item.images.map(img => (
                                                <button
                                                    key={img.image_index}
                                                    onClick={() => openModal(item.product_variant_id, img.image_index)}
                                                    className={cn(
                                                        "relative border rounded-md bg-gray-50 flex-shrink-0",
                                                        "w-24 h-24 flex items-center justify-center hover:border-blue-400 transition-colors"
                                                    )}
                                                >
                                                    <img
                                                        src={img.image_url}
                                                        alt={item.product_name}
                                                        className="max-w-full max-h-full object-contain p-1"
                                                    />
                                                    {img.review_status === 'REVIEWED' && (
                                                        <div className="absolute top-1 right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Right: PVID-level Fields */}
                                    <div className="flex-1 min-w-0">
                                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                                            <div>
                                                <span className="block text-xs font-semibold text-gray-400 uppercase">PVID</span>
                                                <span className="font-mono text-gray-900">{item.product_variant_id}</span>
                                            </div>
                                            <div>
                                                <span className="block text-xs font-semibold text-gray-400 uppercase">Brand</span>
                                                <span className="text-gray-900">{item.brand_name}</span>
                                            </div>
                                            <div>
                                                <span className="block text-xs font-semibold text-gray-400 uppercase">Category (L1)</span>
                                                <span className="text-gray-900">{item.category_name}</span>
                                            </div>
                                            <div>
                                                <span className="block text-xs font-semibold text-gray-400 uppercase">Subcategory (L2)</span>
                                                <span className="text-gray-900">{item.subcategory_name}</span>
                                            </div>
                                            <div>
                                                <span className="block text-xs font-semibold text-gray-400 uppercase">L3</span>
                                                <span className="text-gray-900">{item.l3_category_name}</span>
                                            </div>
                                            <div>
                                                <span className="block text-xs font-semibold text-gray-400 uppercase">Created Bucket</span>
                                                <span className="text-gray-900">{item.created_date_bucket_label || "-"}</span>
                                            </div>
                                            <div className="col-span-2 mt-2">
                                                <span className={cn(
                                                    "px-3 py-1 rounded-full text-xs font-bold border",
                                                    item.pvid_review_status === 'REVIEWED'
                                                        ? "bg-green-100 text-green-800 border-green-200"
                                                        : "bg-red-100 text-red-800 border-red-200"
                                                )}>
                                                    {item.pvid_review_status === 'REVIEWED' ? "REVIEWED" : "NOT REVIEWED"}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}

                        {isLoading && (
                            <div className="space-y-4">
                                {[1, 2, 3].map(i => (
                                    <div key={i} className="h-32 bg-gray-100 animate-pulse rounded-lg" />
                                ))}
                            </div>
                        )}

                        {!isLoading && !error && imagesData?.items.length === 0 && (
                            <div className="text-center py-20 text-gray-400 flex flex-col items-center">
                                <div className="bg-gray-100 p-4 rounded-full mb-4"><AlertCircle size={32} className="text-gray-300" /></div>
                                <div>No images found matching your filters.</div>
                            </div>
                        )}
                    </div>
                </main>
            </div>

            <footer className="bg-white border-t p-4 flex justify-between items-center sticky bottom-0 shrink-0 z-20 shadow-[0_-1px_3px_rgba(0,0,0,0.05)]">
                <div className="text-xs text-gray-500 font-medium">
                    Page {page} • 100 items/page
                </div>
                <div className="flex gap-2">
                    <button
                        disabled={page === 1 || isLoading}
                        onClick={() => setPage(p => p - 1)}
                        className="p-2 border rounded hover:bg-gray-100 disabled:opacity-50 disabled:bg-gray-50 transition-colors"
                    >
                        <ChevronLeft size={16} />
                    </button>
                    <button
                        disabled={!imagesData?.has_more || isLoading}
                        onClick={() => setPage(p => p + 1)}
                        className="p-2 border rounded hover:bg-gray-100 disabled:opacity-50 disabled:bg-gray-50 transition-colors"
                    >
                        <ChevronRight size={16} />
                    </button>
                </div>
            </footer>

            {/* Modal */}
            {modalPvidItem && modalImageIndex !== null && (
                <ImageModal
                    pvidItem={modalPvidItem}
                    selectedImageIndex={modalImageIndex}
                    onClose={closeModal}
                    onImageSelect={setModalImageIndex}
                    onToggleStatus={handleToggleStatus}
                    onToggleIssue={handleToggleIssue}
                    canWrite={canWrite}
                    email={email}
                />
            )}
        </div>
    );
}
