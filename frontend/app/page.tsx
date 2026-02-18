'use client';

import { useState, useEffect, useRef } from 'react';
import { useSession, signIn, signOut, SessionProvider } from "next-auth/react";
import useSWR from 'swr';
import { Loader2, X, ChevronLeft, ChevronRight, LogOut, AlertCircle, Check, Search, Save } from 'lucide-react';
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
    less_than_5_images: boolean;
    sequence_incorrect: boolean;
    duplicate_images: boolean;
};

type ImageItem = {
    image_index: number;
    image_url: string;
    aspect_ratio_value: string | null;
    meta_3x4: string | null;
    image_link_3x4: string | null;
    hide_padding: boolean | null;
    dpi: number | null;
    white_bg: boolean | null;
    review_status: string;
    issues: ImageIssues;
    remark: string | null;
    updated_by: string | null;
    updated_at: string | null;
    last_updated_at: string | null;
    last_updated_by: string | null;
};

// ... existing code ...

const PvidHeader = ({ item }: { item: PvidItem }) => {
    return (
        <div className="grid grid-cols-3 gap-y-2 gap-x-4 text-sm mb-4 border-b pb-3">
            {/* Row 1 */}
            <div className="flex flex-col">
                <span className="text-[10px] text-gray-500 uppercase font-bold">PVID</span>
                <span className="font-mono font-medium truncate" title={item.product_variant_id}>{item.product_variant_id}</span>
            </div>
            <div className="flex flex-col">
                <span className="text-[10px] text-gray-500 uppercase font-bold">Brand</span>
                <span className="truncate" title={item.brand_name}>{item.brand_name || '-'}</span>
            </div>
            <div className="flex flex-col">
                <span className="text-[10px] text-gray-500 uppercase font-bold">Created Bucket</span>
                <span className="truncate">{item.created_date_bucket_label || '-'}</span>
            </div>

            {/* Row 2 */}
            <div className="flex flex-col">
                <span className="text-[10px] text-gray-500 uppercase font-bold">Category (L1)</span>
                <span className="truncate" title={item.category_name}>{item.category_name || '-'}</span>
            </div>
            <div className="flex flex-col">
                <span className="text-[10px] text-gray-500 uppercase font-bold">Subcategory (L2)</span>
                <span className="truncate" title={item.subcategory_name}>{item.subcategory_name || '-'}</span>
            </div>
            <div className="flex flex-col">
                <span className="text-[10px] text-gray-500 uppercase font-bold">L3 Category</span>
                <span className="truncate" title={item.l3_category_name}>{item.l3_category_name || '-'}</span>
            </div>
        </div>

    );
};


type PvidItem = {
    product_variant_id: string;
    brand_name: string;
    product_name: string;
    category_name: string;
    subcategory_name: string;
    l3_category_name: string;
    packsize?: string | number | null;
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

    // Comments State
    const [remark, setRemark] = useState(selectedImage.remark || '');
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

    // Sync local remark when image changes or data updates
    useEffect(() => {
        setRemark(selectedImage.remark || '');
        setSaveStatus('idle');
    }, [selectedImage.remark, selectedImage.image_index]);

    const handleSaveRemark = async () => {
        if (!email || !canWrite) return;
        setSaveStatus('saving');
        try {
            await fetch(`${API_BASE}/qc/remark`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    product_variant_id: pvidItem.product_variant_id,
                    image_index: selectedImage.image_index,
                    actor: email,
                    remark: remark
                })
            });
            setSaveStatus('saved');
            // Revert state after delay
            setTimeout(() => setSaveStatus('idle'), 2000);
        } catch (e) {
            console.error(e);
            setSaveStatus('error');
            setTimeout(() => setSaveStatus('idle'), 3000);
        }
    };

    const handleRemarkChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setRemark(e.target.value);
        if (saveStatus !== 'idle') setSaveStatus('idle');
    };

    // Keyboard Navigation & Esc
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowLeft') {
                const currentIndex = pvidItem.images.findIndex(img => img.image_index === selectedImageIndex);
                if (currentIndex > 0) {
                    onImageSelect(pvidItem.images[currentIndex - 1].image_index);
                }
            }
            if (e.key === 'ArrowRight') {
                const currentIndex = pvidItem.images.findIndex(img => img.image_index === selectedImageIndex);
                if (currentIndex < pvidItem.images.length - 1) {
                    onImageSelect(pvidItem.images[currentIndex + 1].image_index);
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        // Prevent body scroll while modal is open
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = 'unset';
        };
    }, [onClose, selectedImageIndex, onImageSelect, pvidItem.images]);

    // Scroll active thumbnail into view
    const thumbnailRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (thumbnailRef.current) {
            thumbnailRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    }, [selectedImageIndex]);

    if (!selectedImage) return null;

    const issueLabels = {
        image_blur: 'Image Blur',
        cropped_image: 'Cropped Image',
        mrp_present_in_image: 'MRP Present',
        image_quality: 'Image Quality',
        aspect_ratio: 'Aspect Ratio',
        less_than_5_images: 'Less than 5 images',
        sequence_incorrect: 'Sequence incorrect',
        duplicate_images: 'Duplicate images',
    };

    const meta3x4 = selectedImage.meta_3x4 || "";
    const has3x4Link = !!selectedImage.image_link_3x4;
    const is3x4Mode = meta3x4.toUpperCase() === "YES" && has3x4Link;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
            {/* Modal Container: Max dimensions constrained to viewport */}
            <div
                className="relative flex flex-col md:flex-row bg-white rounded-lg shadow-2xl overflow-hidden w-full max-w-[1100px] h-full max-h-[720px]"
                onClick={e => e.stopPropagation()}
                style={{ height: '92vh', width: '92vw' }} // Responsive fallback
            >
                {/* Close Button */}
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 z-50 p-2 bg-gray-100/80 hover:bg-gray-200 rounded-full text-gray-600 transition-colors shadow-sm"
                >
                    <X size={20} />
                </button>

                {/* LEFT: Image Area */}
                <div className="flex-1 bg-white flex flex-col relative h-[50vh] md:h-full min-w-0">
                    <div className="flex-1 flex items-center justify-center p-6 relative overflow-hidden">

                        {is3x4Mode ? (
                            // Side-by-side View
                            <div className="grid grid-cols-2 gap-4 w-full h-full">
                                <div className="flex flex-col h-full bg-gray-50 rounded-lg overflow-hidden border border-gray-100">
                                    <div className="bg-gray-100 px-3 py-1 text-[10px] font-bold text-gray-500 uppercase text-center tracking-wider">Original</div>
                                    <div className="flex-1 relative flex items-center justify-center p-2">
                                        <img
                                            src={selectedImage.image_url}
                                            alt="Original"
                                            className="max-w-full max-h-full object-contain"
                                        />
                                    </div>
                                </div>
                                <div className="flex flex-col h-full bg-gray-50 rounded-lg overflow-hidden border border-gray-100">
                                    <div className="bg-blue-50 px-3 py-1 text-[10px] font-bold text-blue-600 uppercase text-center tracking-wider">3x4 Variant</div>
                                    <div className="flex-1 relative flex items-center justify-center p-2">
                                        <img
                                            src={selectedImage.image_link_3x4!}
                                            alt="3x4 Variant"
                                            className="max-w-full max-h-full object-contain"
                                        />
                                    </div>
                                </div>
                            </div>
                        ) : (
                            // Single Image View
                            <img
                                src={selectedImage.image_url}
                                alt="Preview"
                                className="max-w-full max-h-full object-contain"
                            />
                        )}

                        {/* Navigation Arrows */}
                        {pvidItem.images.findIndex(img => img.image_index === selectedImageIndex) > 0 && (
                            <button
                                className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-gray-100/90 hover:bg-gray-200 text-gray-700 shadow-md transition-colors z-20"
                                onClick={() => {
                                    const currentIndex = pvidItem.images.findIndex(img => img.image_index === selectedImageIndex);
                                    if (currentIndex > 0) onImageSelect(pvidItem.images[currentIndex - 1].image_index);
                                }}
                            >
                                <ChevronLeft size={24} />
                            </button>
                        )}
                        {pvidItem.images.findIndex(img => img.image_index === selectedImageIndex) < pvidItem.images.length - 1 && (
                            <button
                                className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-gray-100/90 hover:bg-gray-200 text-gray-700 shadow-md transition-colors z-20"
                                onClick={() => {
                                    const currentIndex = pvidItem.images.findIndex(img => img.image_index === selectedImageIndex);
                                    if (currentIndex < pvidItem.images.length - 1) onImageSelect(pvidItem.images[currentIndex + 1].image_index);
                                }}
                            >
                                <ChevronRight size={24} />
                            </button>
                        )}
                    </div>

                    {/* Bottom Strip */}
                    <div className="h-20 bg-gray-50 flex items-center gap-2 px-4 overflow-x-auto border-t border-gray-100 shrink-0">
                        {pvidItem.images.map(img => (
                            <div
                                key={img.image_index}
                                ref={img.image_index === selectedImageIndex ? thumbnailRef : null}
                                onClick={() => onImageSelect(img.image_index)}
                                className={cn(
                                    "relative h-14 w-14 min-w-[3.5rem] cursor-pointer rounded-md overflow-hidden border-2 transition-all",
                                    selectedImage.image_index === img.image_index
                                        ? "border-blue-500 ring-1 ring-blue-500"
                                        : "border-gray-200 hover:border-gray-300 opacity-70 hover:opacity-100"
                                )}
                            >
                                <img src={img.image_url} className="w-full h-full object-cover bg-white" loading="lazy" />
                                {img.review_status === 'REVIEWED' && (
                                    <div className="absolute top-0 right-0 bg-green-500 rounded-bl p-0.5">
                                        <Check size={8} className="text-white" />
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* RIGHT: Sidebar */}
                <div className="w-full md:w-[350px] bg-white border-l border-gray-100 flex flex-col h-[50vh] md:h-full shrink-0 overflow-hidden">
                    <div className="p-6 pb-4 border-b border-gray-100 bg-white z-10">
                        <h2 className="font-bold text-lg text-gray-900 leading-tight mb-2 break-words line-clamp-3">{pvidItem.product_name}</h2>

                        {/* Header: PVID & Brand (Stacked) */}
                        <div className="flex flex-col gap-2 mb-3 text-xs text-gray-500">
                            <span className="font-mono text-gray-400">{pvidItem.product_variant_id}</span>
                            <span className="inline-flex items-center w-fit px-2 py-1 rounded-md bg-gray-100 text-gray-700 font-medium text-xs">
                                Brand: {pvidItem.brand_name || '-'}
                            </span>
                        </div>

                        {/* Review Status Toggle */}
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-gray-500">Status</span>
                            <button
                                onClick={() => onToggleStatus(pvidItem.product_variant_id, selectedImage.image_index)}
                                disabled={!canWrite}
                                className={cn(
                                    "text-xs font-bold px-4 py-1.5 rounded-full transition-all border flex items-center gap-1.5",
                                    !canWrite && "opacity-50 cursor-not-allowed",
                                    selectedImage.review_status === 'REVIEWED'
                                        ? "bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                                        : "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
                                )}
                            >
                                {selectedImage.review_status === 'REVIEWED' ? (
                                    <> <Check size={12} /> REVIEWED </>
                                ) : (
                                    <> <X size={12} /> PENDING </>
                                )}
                            </button>
                        </div>
                    </div>

                    <div className="p-6 space-y-6 flex-1 overflow-y-auto">
                        {/* Attributes */}
                        <div className="space-y-3">
                            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Attributes</h3>
                            <div className="grid grid-cols-2 gap-3 text-sm">
                                <div className="border border-gray-200 bg-gray-50 rounded-md px-3 py-2">
                                    <span className="block text-[10px] font-bold text-gray-400 uppercase">Aspect Ratio</span>
                                    <span className="text-sm font-medium text-gray-800">{selectedImage.aspect_ratio_value || "-"}</span>
                                </div>
                                <div className="border border-gray-200 bg-gray-50 rounded-md px-3 py-2">
                                    <span className="block text-[10px] font-bold text-gray-400 uppercase">DPI</span>
                                    <span className="text-sm font-medium text-gray-800">{selectedImage.dpi ?? "-"}</span>
                                </div>
                                <div className="border border-gray-200 bg-gray-50 rounded-md px-3 py-2">
                                    <span className="block text-[10px] font-bold text-gray-400 uppercase">Hide Padding</span>
                                    <span className="text-sm font-medium text-gray-800">{selectedImage.hide_padding === true ? "Yes" : selectedImage.hide_padding === false ? "No" : "-"}</span>
                                </div>
                                <div className="border border-gray-200 bg-gray-50 rounded-md px-3 py-2">
                                    <span className="block text-[10px] font-bold text-gray-400 uppercase">White BG</span>
                                    <span className="text-sm font-medium text-gray-800">{selectedImage.white_bg === true ? "Yes" : selectedImage.white_bg === false ? "No" : "-"}</span>
                                </div>
                                <div className="border border-gray-200 bg-gray-50 rounded-md px-3 py-2">
                                    <span className="block text-[10px] font-bold text-gray-400 uppercase">Pack Size</span>
                                    <span className="text-sm font-medium text-gray-800 break-all">{pvidItem.packsize || "-"}</span>
                                </div>
                                <div className="border border-gray-200 bg-gray-50 rounded-md px-3 py-2">
                                    <span className="block text-[10px] font-bold text-gray-400 uppercase">Meta 3x4</span>
                                    <span className="text-sm font-medium text-gray-800 break-all">{selectedImage.meta_3x4 || "-"}</span>
                                </div>
                                <div className="border border-gray-200 bg-gray-50 rounded-md px-3 py-2">
                                    <span className="block text-[10px] font-bold text-gray-400 uppercase">Last Updated At</span>
                                    <span className="text-sm font-medium text-gray-800 break-all font-mono text-xs">{selectedImage.last_updated_at ? new Date(selectedImage.last_updated_at).toLocaleString() : "-"}</span>
                                </div>
                                <div className="border border-gray-200 bg-gray-50 rounded-md px-3 py-2">
                                    <span className="block text-[10px] font-bold text-gray-400 uppercase">Last Updated By</span>
                                    <span className="text-sm font-medium text-gray-800 break-all text-xs" title={selectedImage.last_updated_by || ""}>{selectedImage.last_updated_by || "-"}</span>
                                </div>
                            </div>
                        </div>

                        {/* Issues */}
                        <div className="space-y-3">
                            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Issues</h3>
                            <div className="flex flex-col gap-1.5">
                                {Object.keys(issueLabels).map((k) => {
                                    const key = k as keyof ImageIssues;
                                    const isActive = selectedImage.issues[key];
                                    return (
                                        <label
                                            key={key}
                                            className={cn(
                                                "flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-all border",
                                                isActive ? "bg-red-50 border-red-200" : "bg-white border-transparent hover:bg-gray-50"
                                            )}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={isActive}
                                                disabled={!canWrite}
                                                onChange={(e) => onToggleIssue(pvidItem.product_variant_id, selectedImage.image_index, key, e.target.checked)}
                                                className="w-4 h-4 text-red-600 rounded focus:ring-red-500 border-gray-300"
                                            />
                                            <span className={cn("text-sm", isActive ? "text-red-700 font-medium" : "text-gray-600")}>
                                                {issueLabels[key]}
                                            </span>
                                        </label>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Comments */}
                        <div className="space-y-2 pt-2 border-t border-gray-100">
                            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none">Comments</h3>
                            <textarea
                                className="w-full text-sm p-3 border border-gray-200 rounded-md bg-gray-50/50 focus:bg-white focus:ring-1 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-all min-h-[80px] resize-none placeholder:text-gray-400"
                                placeholder={canWrite ? "Add optional remarks..." : "No remarks."}
                                value={remark}
                                onChange={handleRemarkChange}
                                disabled={!canWrite}
                            />
                            {/* Save Button */}
                            <div className="flex justify-end pt-1">
                                <button
                                    onClick={handleSaveRemark}
                                    disabled={saveStatus === 'saving' || !canWrite || remark === (selectedImage.remark || '')}
                                    className={cn(
                                        "flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-md shadow-sm transition-all",
                                        saveStatus === 'saved'
                                            ? "bg-green-100 text-green-700 border border-green-200"
                                            : "bg-blue-600 text-white hover:bg-blue-700 border border-transparent disabled:bg-gray-100 disabled:text-gray-400 disabled:shadow-none disabled:cursor-not-allowed"
                                    )}
                                >
                                    {saveStatus === 'saving' ? (
                                        <> <Loader2 size={14} className="animate-spin" /> Saving... </>
                                    ) : saveStatus === 'saved' ? (
                                        <> <Check size={14} /> Saved </>
                                    ) : (
                                        <> <Save size={14} /> Save Remark </>
                                    )}
                                </button>
                            </div>
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
        brand: string[];
        l1: string[];
        bucket: string[];
        pvid: string;
    }

    const [filters, setFilters] = useState<FilterState>({
        status: 'All',
        brand: ['All'],
        l1: ['All'],
        bucket: ['All'],
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

        // Handle arrays
        if (filters.brand && !filters.brand.includes('All')) {
            filters.brand.forEach(b => p.append('brand', b));
        }

        if (filters.l1 && !filters.l1.includes('All')) {
            filters.l1.forEach(c => p.append('category_name', c));
        }

        if (filters.bucket && !filters.bucket.includes('All')) {
            filters.bucket.forEach(b => p.append('created_bucket', b));
        }

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

        // Optimistic Update
        await mutate(async (currentData) => {
            if (!currentData) return undefined;
            // Deep copy to satisfy SWR immutability
            const newData = JSON.parse(JSON.stringify(currentData));

            const pvidItem = newData.items.find((item: PvidItem) => item.product_variant_id === pvid);
            if (pvidItem) {
                const img = pvidItem.images.find((img: ImageItem) => img.image_index === imageIndex);
                if (img) {
                    img.review_status = img.review_status === 'REVIEWED' ? 'NOT_REVIEWED' : 'REVIEWED';

                    // Re-calc PVID status
                    const allReviewed = pvidItem.images.every((i: ImageItem) => i.review_status === 'REVIEWED') && pvidItem.images.length > 0;
                    pvidItem.pvid_review_status = allReviewed ? 'REVIEWED' : 'NOT_REVIEWED';
                }
            }
            return newData;
        }, { revalidate: false });

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
            // Success: Keep optimistic state. Do NOT refetch.
        } catch (e) {
            // Failure: Revalidate to rollback
            mutate();
            alert("Failed to toggle status");
        }
    };

    const handleToggleIssue = async (pvid: string, imageIndex: number, issueKey: string, value: boolean) => {
        if (!canWrite || !email) return;

        // Optimistic Update
        await mutate(async (currentData) => {
            if (!currentData) return undefined;
            const newData = JSON.parse(JSON.stringify(currentData));

            const pvidItem = newData.items.find((item: PvidItem) => item.product_variant_id === pvid);
            if (pvidItem) {
                const img = pvidItem.images.find((img: ImageItem) => img.image_index === imageIndex);
                if (img) {
                    img.issues[issueKey] = value;
                }
            }
            return newData;
        }, { revalidate: false });

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
            // Success: Keep optimistic state
        } catch (e) {
            mutate();
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
                    <div className="flex justify-center mb-6">
                        {/* ZEPTO LOGO - Upload to public/brand/zepto-logo.png */}
                        <img src="/brand/zepto-logo.png" alt="Zepto" className="h-12 w-auto" />
                    </div>
                    <h1 className="text-xl font-bold mb-6 text-gray-800">Image QC Login</h1>
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
                <div className="flex items-center gap-3">
                    {/* ZEPTO LOGO Header */}
                    <img src="/brand/zepto-logo.png" alt="Zepto" className="h-8 w-auto cursor-pointer" onClick={() => window.location.href = '/'} />
                    <span className="text-xl font-bold text-gray-300">|</span>
                    <h1 className="text-lg font-semibold text-gray-700">Image QC</h1>
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-sm text-right">
                        <div className="font-medium text-gray-900">{email}</div>
                        <div className={cn(
                            "inline-flex px-2 py-0.5 rounded text-[10px] uppercase font-bold mt-0.5",
                            canWrite ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                        )}>
                            {canWrite ? role : `${role} (Read Only)`}
                        </div>
                    </div>
                    {isLoading && <Loader2 className="animate-spin text-gray-400" />}
                    <button onClick={logout} className="text-gray-500 hover:text-red-600 p-2 rounded-full hover:bg-gray-100 transition-colors" title="Logout"><LogOut size={20} /></button>
                </div>
            </header>

            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar */}
                <aside className="w-72 bg-white border-r p-4 overflow-y-auto hidden md:block shrink-0">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="font-bold">Filters</h2>
                        <button
                            onClick={() => { setFilters({ status: 'All', brand: ['All'], l1: ['All'], bucket: ['All'], pvid: '' }); setPage(1); }}
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

                        {/* Multi-Select Bucket */}
                        <MultiSelectDropdown
                            label="Created bucket"
                            options={filterOptions?.created_date_buckets || ['All']}
                            selected={filters.bucket}
                            onChange={(val) => updateFilter('bucket', val)}
                        />

                        {/* Multi-Select Brand */}
                        <MultiSelectDropdown
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
                                    {/* Right: PVID-level Fields */}
                                    <div className="flex-1 min-w-0">
                                        <PvidHeader item={item} />

                                        {/* Status Chip (Optional, if not covered in Header or if needed here as well) */}
                                        {/* The new PVIDHeader covers cols but maybe not the status chip in the same way? 
                                             Wait, the design request said:
                                             Row 1: PVID | Brand | Created bucket
                                             Row 2: Category (L1) | Subcategory (L2) | L3
                                             It did NOT mention status. 
                                             The original code had status. I should probably keep status visible?
                                             The user request D says "row 1... row 2..." strictly.
                                             But removing status from the list view might be bad.
                                             I'll add the status chip below the header or integrated.
                                             Actually, status is quite important.
                                             I'll render the status chip below the PVIDHeader for now.
                                         */}
                                        <div className="flex justify-end mt-2">
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
