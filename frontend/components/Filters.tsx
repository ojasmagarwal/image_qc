import { useState, useEffect, useRef } from 'react';
import { ChevronRight, Search, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export function MultiSelectDropdown({
    options,
    selected,
    onChange,
    label
}: {
    options: string[];
    selected: string[];
    onChange: (newSelected: string[]) => void;
    label: string;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);

    // Filter options based on search
    const filteredOptions = options.filter(opt =>
        opt.toLowerCase().includes(search.toLowerCase())
    );

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const toggleOption = (option: string) => {
        if (option === 'All') {
            onChange(['All']);
            // setIsOpen(false); // Optional: close on 'All' select? No, generic behavior usually keeps open.
            return;
        }

        let newSelected = [...selected];
        if (newSelected.includes('All')) {
            newSelected = [];
        }

        if (newSelected.includes(option)) {
            newSelected = newSelected.filter(item => item !== option);
        } else {
            newSelected.push(option);
        }

        if (newSelected.length === 0) {
            newSelected = ['All'];
        }
        onChange(newSelected);
    };

    return (
        <div className="relative" ref={containerRef}>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase">{label}</label>
            <button
                type="button"
                onClick={() => {
                    setIsOpen(!isOpen);
                    if (!isOpen) setSearch(''); // Clear search on open
                }}
                className="w-full text-left bg-white border border-gray-300 rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 flex justify-between items-center bg-gray-50"
            >
                <div className="flex gap-1 flex-wrap truncate">
                    {selected.includes('All')
                        ? 'All'
                        : selected.length > 1
                            ? `${selected.length} selected`
                            : selected.join(', ')}
                </div>
                <ChevronRight className={cn("h-4 w-4 transition-transform text-gray-500", isOpen && "rotate-90")} />
            </button>

            {isOpen && (
                <div className="absolute z-50 mt-1 w-full min-w-[200px] bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-hidden flex flex-col">
                    <div className="p-2 border-b bg-gray-50 sticky top-0 z-10">
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Search..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="w-full p-1.5 pl-8 text-sm border rounded focus:outline-none focus:border-blue-500"
                                autoFocus
                            />
                            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-gray-400" />
                        </div>
                    </div>
                    <div className="overflow-y-auto flex-1">
                        {filteredOptions.length > 0 ? (
                            filteredOptions.map(option => {
                                const isSelected = selected.includes(option);
                                return (
                                    <div
                                        key={option}
                                        className={cn(
                                            "cursor-pointer px-3 py-2 text-sm hover:bg-gray-100 flex items-center gap-2",
                                            isSelected && "bg-blue-50 text-blue-700"
                                        )}
                                        onClick={() => toggleOption(option)}
                                    >
                                        <div className={cn(
                                            "w-4 h-4 border rounded flex items-center justify-center transition-colors flex-shrink-0",
                                            isSelected ? "bg-blue-600 border-blue-600" : "border-gray-300"
                                        )}>
                                            {isSelected && <Check size={12} className="text-white" />}
                                        </div>
                                        {option}
                                    </div>
                                );
                            })
                        ) : (
                            <div className="px-3 py-2 text-sm text-gray-400 text-center">No results</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export function SearchableBrandDropdown({
    options,
    selected,
    onChange,
    label
}: {
    options: string[];
    selected: string;
    onChange: (val: string) => void;
    label: string;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);

    // Filter options based on search
    const filteredOptions = options.filter(opt =>
        opt.toLowerCase().includes(search.toLowerCase())
    );

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // When selected changes externally or initially, if it's not "All", we might want to reflect that? 
    // Actually we just show selected value in input if not open? No, let's keep input for searching.
    // Standard combobox behavior: Input displays selected value, typing filters list.

    useEffect(() => {
        if (!isOpen) {
            // When closed, reset search/input to selected value if it's not All, or keep it empty/All
            setSearch(selected === 'All' ? '' : selected);
        }
    }, [isOpen, selected]);

    return (
        <div className="relative" ref={containerRef}>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase">{label}</label>
            <div className="relative">
                <div className="relative">
                    <input
                        type="text"
                        value={isOpen ? search : (selected === 'All' ? 'All' : selected)}
                        onClick={() => {
                            setIsOpen(true);
                            setSearch(''); // Clear to show all options when first clicking? Or keep current?
                            // Common pattern: click selects all text or clears for fresh search
                        }}
                        onChange={(e) => {
                            setSearch(e.target.value);
                            if (!isOpen) setIsOpen(true);
                        }}
                        onFocus={() => {
                            setIsOpen(true);
                            setSearch(''); // clear on focus to make searching easier
                        }}
                        placeholder="Select Brand..."
                        className="w-full bg-white border border-gray-300 rounded-md py-2 pl-3 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 decoration-none"
                    />
                    <ChevronRight
                        className={cn("absolute right-2 top-2.5 h-4 w-4 transition-transform text-gray-500 pointer-events-none", isOpen && "rotate-90")}
                    />
                </div>

                {isOpen && (
                    <div className="absolute z-50 mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                        {filteredOptions.length > 0 ? (
                            filteredOptions.map(option => (
                                <div
                                    key={option}
                                    className={cn(
                                        "cursor-pointer px-3 py-2 text-sm hover:bg-gray-100",
                                        selected === option && "bg-blue-50 font-medium text-blue-700"
                                    )}
                                    onClick={() => {
                                        onChange(option);
                                        setIsOpen(false);
                                        setSearch(option);
                                    }}
                                >
                                    {option}
                                </div>
                            ))
                        ) : (
                            <div className="px-3 py-2 text-sm text-gray-400">No results found</div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
