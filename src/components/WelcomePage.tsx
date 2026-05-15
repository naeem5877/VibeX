import React from 'react';
import { motion } from 'framer-motion';
import { LucideIcon, Volume2, FastForward, Music, Download, Type, MonitorPlay, Zap, MousePointer2 } from 'lucide-react';

interface FeatureCardProps {
    title: string;
    description: string;
    icon: LucideIcon;
    color: string;
    index: number;
}

const FeatureCard: React.FC<FeatureCardProps> = ({ title, description, icon: Icon, color, index }) => (
    <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: index * 0.1 }}
        className="premium-card p-6 flex flex-col gap-4 text-left group"
    >
        <div className="w-12 h-12 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110 group-hover:rotate-3" style={{ background: `${color}20` }}>
            <Icon className="w-6 h-6" style={{ color }} />
        </div>
        <div>
            <h3 className="text-lg font-bold text-white mb-2">{title}</h3>
            <p className="text-sm text-slate-400 leading-relaxed">{description}</p>
        </div>
    </motion.div>
);

const WelcomePage: React.FC = () => {
    const features = [
        {
            title: "Smart Volume",
            description: "Full volume slider with persistent sync and instant mute toggle.",
            icon: Volume2,
            color: "#8B5CF6"
        },
        {
            title: "Variable Speed",
            description: "6 precision speed options. Shift your vibe from 0.5x up to 2.0x.",
            icon: FastForward,
            color: "#EC4899"
        },
        {
            title: "Song Search",
            description: "Identify any background track instantly with Shazam-powered engine.",
            icon: Music,
            color: "#3B82F6"
        },
        {
            title: "One-Click Save",
            description: "High-quality video downloads for Posts and Reels. Your gallery, your rules.",
            icon: Download,
            color: "#22C55E"
        },
        {
            title: "Auto-Flow",
            description: "Continuous playback for Reels. Sit back and enjoy the infinite stream.",
            icon: Zap,
            color: "#F59E0B"
        },
        {
            title: "Cinema Mode",
            description: "Picture-in-Picture support for multitasking while watching your favorite reels.",
            icon: MonitorPlay,
            color: "#06B6D4"
        },
        {
            title: "Instant Boost",
            description: "Hold Spacebar for 2x speedup. Release to return. Fastest way to skim.",
            icon: Type,
            color: "#EF4444"
        },
        {
            title: "Pro Seekbar",
            description: "Precise control with frame-accurate thumbnails. Never miss a moment.",
            icon: MousePointer2,
            color: "#8B5CF6"
        }
    ];

    return (
        <div className="min-h-screen bg-black text-white selection:bg-violet-500/30 overflow-x-hidden">
            <div className="aura-bg">
                <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 0.15, scale: 1 }}
                    transition={{ duration: 2, ease: "easeOut" }}
                    className="aura-blob top-[-10%] left-[-10%]"
                ></motion.div>
                <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 0.15, scale: 1 }}
                    transition={{ duration: 2, delay: 0.5, ease: "easeOut" }}
                    className="aura-blob aura-blob-2 bottom-[-10%] right-[-10%]"
                ></motion.div>
            </div>

            <main className="relative z-10 max-w-6xl mx-auto px-6 py-20 text-center">
                {/* Header */}
                <div className="mb-20 space-y-6">
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5 }}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400 text-sm font-semibold tracking-wide uppercase"
                    >
                        Welcome to the Future
                    </motion.div>
                    <motion.h1
                        initial={{ opacity: 0, filter: 'blur(10px)' }}
                        animate={{ opacity: 1, filter: 'blur(0px)' }}
                        transition={{ duration: 0.8, delay: 0.2 }}
                        className="text-6xl md:text-8xl font-black tracking-tight aura-gradient-text leading-tight"
                    >
                        Experience <br /> Instagram. Enhanced.
                    </motion.h1>
                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.8, delay: 0.4 }}
                        className="text-xl text-slate-400 max-w-2xl mx-auto"
                    >
                        VibeX transforms your browsing experience with premium controls,
                        seamless animations, and a focus on visual excellence.
                    </motion.p>
                </div>

                {/* Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-20">
                    {features.map((f, i) => (
                        <FeatureCard key={i} {...f} index={i} />
                    ))}
                </div>

                {/* Footer CTA */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    className="premium-card p-12 text-center max-w-3xl mx-auto"
                >
                    <h2 className="text-3xl font-bold mb-4">Ready to vibe?</h2>
                    <p className="text-slate-400 mb-8">
                        Head over to Instagram and hover over any video.
                        The controls are waiting for you.
                    </p>
                    <a
                        href="https://instagram.com"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-3 px-8 py-4 bg-white text-black font-bold rounded-2xl hover:scale-105 transition-transform active:scale-95"
                    >
                        Open Instagram
                        <Zap className="w-5 h-5 fill-current" />
                    </a>
                </motion.div>

                <div className="mt-20 text-slate-500 text-sm">
                    VibeX v1.0.8 • Designed for creators and consumers alike.
                </div>
            </main>
        </div>
    );
};

export default WelcomePage;
