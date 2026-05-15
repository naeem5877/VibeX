import React from 'react';
import { motion } from 'framer-motion';
import { Rocket, CheckCircle2, Star, Sparkles, Layout, Settings2, Info } from 'lucide-react';

interface UpdateItemProps {
    version: string;
    date: string;
    changes: {
        type: 'feature' | 'fix' | 'refinement';
        text: string;
    }[];
    isLatest?: boolean;
    index: number;
}

const UpdateItem: React.FC<UpdateItemProps> = ({ version, date, changes, isLatest, index }) => (
    <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: isLatest ? 1 : 0.6, x: 0 }}
        whileHover={{ opacity: 1, x: 5 }}
        transition={{ duration: 0.5, delay: index * 0.15 }}
        className={`relative pl-8 pb-12 last:pb-0`}
    >
        {/* Timeline line */}
        <div className="absolute left-[11px] top-0 bottom-0 w-[2px] bg-slate-800"></div>
        {/* Dot */}
        <div className={`absolute left-0 top-0 w-6 h-6 rounded-full flex items-center justify-center z-10 ${isLatest ? 'bg-violet-500 shadow-lg shadow-violet-500/40' : 'bg-slate-700'}`}>
            {isLatest ? <Rocket className="w-3 h-3 text-white" /> : <div className="w-2 h-2 rounded-full bg-slate-500" />}
        </div>

        <div className="space-y-4">
            <div className="flex items-center gap-3">
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${isLatest ? 'bg-violet-500/20 text-violet-400' : 'bg-slate-800 text-slate-400'}`}>
                    v{version}
                </span>
                <span className="text-sm text-slate-500 font-medium">{date}</span>
                {isLatest && <span className="flex items-center gap-1 text-xs font-bold text-pink-500 animate-pulse"><Sparkles className="w-3 h-3" /> LATEST</span>}
            </div>

            <div className="premium-card p-6 grid gap-3 hover:border-violet-500/30 transition-colors">
                {changes.map((change, i) => (
                    <div key={i} className="flex gap-3 items-start">
                        <div className="mt-1">
                            {change.type === 'feature' && <Star className="w-4 h-4 text-amber-400" />}
                            {change.type === 'fix' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                            {change.type === 'refinement' && <Layout className="w-4 h-4 text-blue-400" />}
                        </div>
                        <p className="text-slate-300 text-sm leading-relaxed">{change.text}</p>
                    </div>
                ))}
            </div>
        </div>
    </motion.div>
);

const UpdatePage: React.FC = () => {
    return (
        <div className="min-h-screen bg-black text-white p-6 md:p-12 selection:bg-violet-500/30 overflow-x-hidden">
            <div className="aura-bg">
                <div className="aura-blob top-[-5%] right-[-5%]"></div>
                <div className="aura-blob aura-blob-2 bottom-[-5%] left-[-5%]"></div>
            </div>

            <div className="max-w-3xl mx-auto relative z-10">
                <header className="mb-16 space-y-4">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="inline-flex items-center gap-2 text-slate-400 hover:text-white transition-colors cursor-pointer group mb-4"
                    >
                        <Settings2 className="w-4 h-4 group-hover:rotate-90 transition-transform duration-500" />
                        <span className="text-sm font-semibold uppercase tracking-widest">Release Notes</span>
                    </motion.div>
                    <motion.h1
                        initial={{ opacity: 0, x: -30 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.6, delay: 0.2 }}
                        className="text-5xl font-black tracking-tighter aura-gradient-text"
                    >
                        What's New <br /> in VibeX
                    </motion.h1>
                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.6, delay: 0.4 }}
                        className="text-lg text-slate-400 max-w-xl"
                    >
                        We're constantly refining the experience. Here's a look at the latest
                        enhancements and fixes.
                    </motion.p>
                </header>

                <div className="timeline">
                    <UpdateItem
                        index={0}
                        version="3.2.0"
                        date="May 15, 2026"
                        isLatest
                        changes={[
                            { type: 'feature', text: 'Dynamic Home Feed: New vertical control layout specifically optimized for the Instagram home page.' },
                            { type: 'feature', text: 'Shazam Integration: Identify any song playing in a video with the new built-in recognition engine.' },
                            { type: 'refinement', text: 'Enhanced Download UX: Added live status labels (Fetching, Downloading) and a sticky progress state that keeps the bar open.' },
                            { type: 'refinement', text: 'Auto-Close Logic: The control bar now automatically hides only after a successful download.' },
                            { type: 'fix', text: 'Fixed layout glitches, improved icon centering, and refined vertical slider behavior for a smoother experience.' },
                        ]}
                    />
                    <UpdateItem
                        index={1}
                        version="3.1.1"
                        date="February 25, 2026"
                        changes={[
                            { type: 'fix', text: 'Fixed Instagram native mute button conflict: VibeX volume control now works seamlessly without interference from Instagram\'s own mute toggle.' },
                            { type: 'fix', text: 'Minor bug fixes and stability improvements.' },
                        ]}
                    />
                </div>

                <footer className="mt-20 pt-10 border-t border-slate-900 flex flex-col md:flex-row justify-between items-center gap-6">
                    <div className="flex items-center gap-2 text-slate-500 text-sm">
                        <Info className="w-4 h-4" />
                        Your settings stay synced across updates.
                    </div>
                    <button
                        onClick={() => window.close()}
                        className="px-6 py-2.5 rounded-xl border border-white/10 hover:bg-white/5 transition-colors font-bold text-sm"
                    >
                        Dismiss
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default UpdatePage;