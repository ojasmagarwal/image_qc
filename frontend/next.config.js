/** @type {import('next').NextConfig} */
const nextConfig = {
    // Allow external images from S3 (or wherever they are hosted).
    // Ideally we restrict this, but for now allow all or specific domains if known.
    // Since user said "image_url is a real URL", likely from arbitrary S3 buckets.
    images: {
        remotePatterns: [
            {
                protocol: 'https',
                hostname: '**',
            },
        ],
        // If using <img> tag directly (standard HTML), next/image config is less strict, 
        // but good to have if we switch to <Image>.
        // The current code uses <img>, so this is just future-proofing.
    },
};

module.exports = nextConfig;
