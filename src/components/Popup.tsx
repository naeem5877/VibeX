import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Volume2,
    Gauge,
    RotateCcw,
    Activity,
    Command,
    Terminal,
    Settings,
    ChevronDown,
    Zap,
    Sparkles,
    Keyboard,
    Play,
    SkipBack,
    SkipForward,
    Radio
} from 'lucide-react';

interface SettingsData {
    defaultVolume: number;
    playbackSpeed: number;
    autoScroll: boolean;
}

const SPEED_OPTIONS = [0.5, 1.0, 1.2, 1.5, 2.0];

const InfinitePopup: React.FC = () => {
    const [settings, setSettings] = useState<SettingsData>({
        defaultVolume: 1.0,
        playbackSpeed: 1.0,
        autoScroll: false,
    });
    const [shortcutsExpanded, setShortcutsExpanded] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);

    useEffect(() => {
        chrome.storage.sync.get(['defaultVolume', 'playbackSpeed', 'autoScroll'], (result: { [key: string]: unknown }) => {
            setSettings({
                defaultVolume: (typeof result.defaultVolume === 'number' ? result.defaultVolume : 1.0),
                playbackSpeed: (typeof result.playbackSpeed === 'number' ? result.playbackSpeed : 1.0),
                autoScroll: (typeof result.autoScroll === 'boolean' ? result.autoScroll : false),
            });
        });
    }, []);

    const updateVolume = useCallback((value: number) => {
        const volume = value / 100;
        setSettings((prev) => ({ ...prev, defaultVolume: volume }));
        chrome.storage.sync.set({ defaultVolume: volume });
    }, []);

    const updateSpeed = useCallback((speed: number) => {
        setSettings((prev) => ({ ...prev, playbackSpeed: speed }));
        chrome.storage.sync.set({ playbackSpeed: speed });
    }, []);

    const toggleAutoScroll = useCallback(() => {
        setSettings((prev) => {
            const newValue = !prev.autoScroll;
            chrome.storage.sync.set({ autoScroll: newValue });
            return { ...prev, autoScroll: newValue };
        });
    }, []);

    const handleReset = useCallback(() => {
        const defaults = { defaultVolume: 1.0, playbackSpeed: 1.0, autoScroll: false };
        chrome.storage.sync.set(defaults, () => {
            setSettings(defaults);
            setShowSuccess(true);
            setTimeout(() => setShowSuccess(false), 2000);
        });
    }, []);

    return (
        <div className="relative w-[360px] min-h-[560px] bg-[#020204] p-6 flex flex-col font-sans select-none antialiased">
            {/* Background Atmosphere */}
            <div className="glow-atmosphere">
                <div className="aurora" />
                <div className="scanline" />
            </div>

            {/* Integrated Main Panel */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="integrated-surface flex-1 flex flex-col p-6 shadow-2xl relative overflow-hidden"
            >
                {/* Header Section */}
                <header className="flex flex-col items-center mb-8">
                    <motion.div
                        initial={{ scale: 0.9 }}
                        animate={{ scale: 1 }}
                        className="flex items-center gap-2 mb-1"
                    >
                        <Zap size={18} className="text-purple-500 fill-purple-500 animate-vibe-pulse" />
                        <h1 className="text-2xl font-black italic tracking-tighter text-white uppercase">VibeX 3.1.1</h1>
                    </motion.div>
                    <span className="text-[10px] font-bold tracking-[0.4em] text-white/30 uppercase">Neural Stream v3.1.1</span>
                </header>

                {/* Vertical Integrated Controls */}
                <div className="flex flex-col gap-2">
                    {/* Volume Row */}
                    <div className="vibe-row">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-full bg-white/5">
                                    <Volume2 size={16} className="text-purple-400" />
                                </div>
                                <span className="text-xs font-bold text-white/80 uppercase tracking-widest">Acoustics</span>
                            </div>
                            <span className="text-sm font-black text-white tabular-nums">{Math.round(settings.defaultVolume * 100)}%</span>
                        </div>
                        <input
                            type="range"
                            min="0"
                            max="100"
                            value={settings.defaultVolume * 100}
                            onChange={(e) => updateVolume(Number(e.target.value))}
                            className="unified-slider"
                        />
                    </div>

                    {/* Speed Row */}
                    <div className="vibe-row">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-full bg-white/5">
                                    <Gauge size={16} className="text-purple-400" />
                                </div>
                                <span className="text-xs font-bold text-white/80 uppercase tracking-widest">Temporal flow</span>
                            </div>
                            <span className="text-sm font-black text-white tabular-nums">{settings.playbackSpeed.toFixed(1)}X</span>
                        </div>
                        <div className="flex justify-between gap-1.5">
                            {SPEED_OPTIONS.map(s => (
                                <button
                                    key={s}
                                    onClick={() => updateSpeed(s)}
                                    className={`flex-1 py-2 rounded-xl text-[10px] font-black transition-all duration-300 ${settings.playbackSpeed === s ? 'bg-white text-black shadow-lg shadow-white/10' : 'bg-white/5 text-white/40 hover:text-white'}`}
                                >
                                    {s === 1.0 ? 'STD' : `${s}X`}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Auto Flow Row */}
                    <div className="vibe-row flex items-center justify-between py-6">
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-full transition-all duration-500 ${settings.autoScroll ? 'bg-purple-600/20 text-purple-400' : 'bg-white/5 text-white/20'}`}>
                                <Activity size={16} />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[11px] font-bold text-white tracking-widest uppercase">Auto Flow</span>
                                <span className="text-[9px] font-medium text-white/30 uppercase mt-0.5">Scroll Protocol</span>
                            </div>
                        </div>
                        <button
                            onClick={toggleAutoScroll}
                            className={`w-12 h-6 rounded-full relative transition-all duration-500 ${settings.autoScroll ? 'bg-purple-600' : 'bg-white/10'}`}
                        >
                            <motion.div
                                animate={{ x: settings.autoScroll ? 26 : 4 }}
                                className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-lg"
                            />
                        </button>
                    </div>

                    {/* Keyboard Shortcut Integrated Section */}
                    <div className="vibe-row">
                        <button
                            onClick={() => setShortcutsExpanded(!shortcutsExpanded)}
                            className="w-full flex items-center justify-between py-2 group"
                        >
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-full bg-white/5 group-hover:bg-white/10 transition-all">
                                    <Keyboard size={16} className="text-white/40" />
                                </div>
                                <span className="text-[10px] font-black text-white/40 tracking-[0.2em] uppercase">Control Manifest</span>
                            </div>
                            <ChevronDown size={14} className={`text-white/20 transition-transform duration-500 ${shortcutsExpanded ? 'rotate-180' : ''}`} />
                        </button>

                        <AnimatePresence>
                            {shortcutsExpanded && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="overflow-hidden"
                                >
                                    <div className="flex flex-col gap-3 pt-4 pb-2 px-1">
                                        <ShortcutItem label="Master Playback" keybind="SPACE" />
                                        <ShortcutItem label="Temporal Boost" keybind="HOLD SPACE" />
                                        <ShortcutItem label="Neural Navigation" keybind="ARROWS" />
                                        <ShortcutItem label="Stealth Mode" keybind="M" />
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>

                {/* Reset Action */}
                <div className="mt-auto pt-6 flex justify-center">
                    <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={handleReset}
                        className={`group flex items-center gap-3 px-10 py-3.5 rounded-full border transition-all duration-500 ${showSuccess ? 'bg-green-500/10 border-green-500/50 text-green-400' : 'bg-white/5 border-white/5 hover:border-white/20 text-white/40 hover:text-white'}`}
                    >
                        <RotateCcw size={14} className={showSuccess ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'} />
                        <span className="text-[10px] font-black uppercase tracking-[0.3em]">{showSuccess ? 'Core Synced' : 'Reboot Core'}</span>
                    </motion.button>
                </div>
            </motion.div>

            {/* Subtle Diagnostic Footer */}
            <footer className="mt-6 flex justify-between items-center px-4 opacity-20">
                <div className="flex items-center gap-1.5">
                    <Radio size={10} className="animate-pulse" />
                    <span className="text-[8px] font-black uppercase tracking-[0.2em]">Neural Link Stable</span>
                </div>
                <span className="text-[8px] font-black tracking-[0.2em]">OS v3.1.1</span>
            </footer>
        </div>
    );
};

const ShortcutItem: React.FC<{ label: string, keybind: string }> = ({ label, keybind }) => (
    <div className="flex items-center justify-between group/item">
        <span className="text-[11px] font-bold text-white/50 group-hover/item:text-white/80 transition-colors">{label}</span>
        <span className="keycap group-hover/item:border-white/30 transition-all">{keybind}</span>
    </div>
);

export default InfinitePopup;
