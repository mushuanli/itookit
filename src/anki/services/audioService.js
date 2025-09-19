// src/anki/services/audioService.js

class AudioService {
    constructor() {
        this.dom = {
            audioControls: document.getElementById('anki_audioControls'),
            audioTitle: document.getElementById('anki_audioTitle'),
            audioProgress: document.getElementById('anki_audioProgressBar'),
            playBtn: document.getElementById('anki_playBtn'),
            pauseBtn: document.getElementById('anki_pauseBtn'),
            stopBtn: document.getElementById('anki_stopBtn'),
        };
        this.currentUtterance = null;
        this.progressInterval = null;
    }

    initialize() {
        if (!this.dom.playBtn) return; // 如果DOM不存在，则不进行初始化
        this.dom.playBtn.addEventListener('click', () => this.resume());
        this.dom.pauseBtn.addEventListener('click', () => this.pause());
        this.dom.stopBtn.addEventListener('click', () => this.stop());
    }

    play(text) {
        if (!('speechSynthesis' in window)) {
            alert("抱歉，您的浏览器不支持语音合成。");
            return;
        }
        this.stop(); // 播放前先停止任何正在播放的语音

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        utterance.rate = 1.0;

        utterance.onstart = () => {
            utterance.startTime = Date.now();
            this.progressInterval = setInterval(() => this._updateProgress(), 100);
            this.dom.audioControls.style.display = 'flex';
        };

        utterance.onend = () => {
            this.stop();
        };

        this.currentUtterance = utterance;
        this.dom.audioTitle.textContent = `正在播放: ${text.substring(0, 30)}${text.length > 30 ? '...' : ''}`;
        
        window.speechSynthesis.speak(utterance);
    }

    pause() {
        if (window.speechSynthesis.speaking) {
            window.speechSynthesis.pause();
            clearInterval(this.progressInterval);
        }
    }

    resume() {
        if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
            this.progressInterval = setInterval(() => this._updateProgress(), 100);
        }
    }

    stop() {
        window.speechSynthesis.cancel();
        if (this.progressInterval) clearInterval(this.progressInterval);
        if(this.dom.audioControls) this.dom.audioControls.style.display = 'none';
        if(this.dom.audioProgress) this.dom.audioProgress.style.width = '0%';
        this.currentUtterance = null;
    }

    _updateProgress() {
        if (!this.currentUtterance || !this.currentUtterance.startTime) return;
        const elapsed = (Date.now() - this.currentUtterance.startTime) / 1000;
        const estimatedDuration = this.currentUtterance.text.length / 10; // 粗略估算
        const progress = Math.min(100, (elapsed / estimatedDuration) * 100);
        this.dom.audioProgress.style.width = `${progress}%`;
    }
}

export const audioService = new AudioService();
