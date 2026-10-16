import { useState } from 'react';
import { Bot, X } from 'lucide-react';

// Floating chatbot launcher (KinMel assistant).
// Pure vector + CSS animation — no image asset, crisp at any size.
export default function ChatbotButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <style>{`
        @keyframes chatbot-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        @keyframes chatbot-typing {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
        .chatbot-float { animation: chatbot-float 3s ease-in-out infinite; }
        .chatbot-dot { animation: chatbot-typing 1.4s infinite; }
        .chatbot-dot:nth-child(2) { animation-delay: 0.2s; }
        .chatbot-dot:nth-child(3) { animation-delay: 0.4s; }
      `}</style>

      <div className="fixed bottom-12 right-8 z-50 flex flex-col items-end gap-4">
        {open && (
          <div className="w-80 animate-fadeIn overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xl">
            <div className="flex items-center gap-3 bg-black p-4 text-white">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-white/15">
                <Bot size={22} strokeWidth={2} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold leading-none">KinMel Assistant</p>
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-green-400">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                    <span className="h-2 w-2 rounded-full bg-green-400" />
                  </span>
                  Online — replies instantly
                </p>
              </div>
            </div>
            <div className="space-y-3 p-4">
              <div className="w-fit max-w-[90%] rounded-2xl rounded-tl-md bg-gray-100 px-4 py-2.5 text-sm text-gray-800">
                Hi! I can help you find products. Full chat coming soon.
              </div>
              <div className="flex items-center gap-1.5 px-1">
                <span className="chatbot-dot h-1.5 w-1.5 rounded-full bg-gray-400" />
                <span className="chatbot-dot h-1.5 w-1.5 rounded-full bg-gray-400" />
                <span className="chatbot-dot h-1.5 w-1.5 rounded-full bg-gray-400" />
              </div>
            </div>
          </div>
        )}

        {/* Label tooltip */}
        {!open && (
          <div className="pointer-events-none mr-1 rounded-full border border-gray-100 bg-white px-4 py-2 text-sm font-medium shadow-lg">
            Chat with us
          </div>
        )}

        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Chat with assistant"
          className="chatbot-float group relative grid h-[72px] w-[72px] place-items-center rounded-full bg-black text-white shadow-[0_12px_32px_rgba(0,0,0,0.35)] transition-transform duration-300 hover:scale-110 active:scale-95"
        >
          <span
            key={open ? 'x' : 'bot'}
            className="transition-transform duration-300 group-active:rotate-90"
            style={{ animation: 'bounceIn 0.3s ease-out' }}
          >
            {open ? <X size={30} strokeWidth={2.2} /> : <Bot size={34} strokeWidth={1.9} />}
          </span>

          {/* online dot */}
          {!open && (
            <span className="absolute right-1 top-1 flex h-4 w-4">
              <span className="absolute h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="h-4 w-4 rounded-full border-2 border-white bg-green-500" />
            </span>
          )}
        </button>
      </div>
    </>
  );
}
