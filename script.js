class VideoChecker {
    constructor() {
        this.criteria = {
            resolutions: [
                { width: 1920, height: 810 },
                { width: 3840, height: 1620 }
            ],
            frameRate: 24,
            frameCount: 144,
            duration: 6,
            maxFileSize: 100 * 1024 * 1024, // 100MB in bytes
            allowedFormats: ['video/mp4', 'video/quicktime'],
            allowedCodecs: ['h264', 'hevc', 'h265']
        };
        
        this.serverUrl = window.location.origin; // Current server URL
        
        this.initializeElements();
        this.attachEventListeners();
    }

    initializeElements() {
        this.uploadArea = document.getElementById('uploadArea');
        this.fileInput = document.getElementById('fileInput');
        this.results = document.getElementById('results');
        this.loading = document.getElementById('loading');
        this.validationTable = document.getElementById('validationTable');
        this.videoDetails = document.getElementById('videoDetails');
        this.resetBtn = document.getElementById('resetBtn');
    }

    attachEventListeners() {
        // Drag and drop events - Fixed with proper event handling
        this.uploadArea.addEventListener('dragover', (e) => this.handleDragOver(e));
        this.uploadArea.addEventListener('dragenter', (e) => this.handleDragEnter(e));
        this.uploadArea.addEventListener('dragleave', (e) => this.handleDragLeave(e));
        this.uploadArea.addEventListener('drop', (e) => this.handleDrop(e));
        this.uploadArea.addEventListener('click', () => this.fileInput.click());
        
        // File input change
        this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        
        // Reset button
        this.resetBtn.addEventListener('click', () => this.reset());
    }

    handleDragEnter(e) {
        e.preventDefault();
        e.stopPropagation();
        this.uploadArea.classList.add('dragover');
    }

    handleDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        this.uploadArea.classList.add('dragover');
    }

    handleDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        
        // Only remove dragover if we're leaving the upload area entirely
        if (!this.uploadArea.contains(e.relatedTarget)) {
            this.uploadArea.classList.remove('dragover');
        }
    }

    handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        this.uploadArea.classList.remove('dragover');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            this.processFile(files[0]);
        }
    }

    handleFileSelect(e) {
        const file = e.target.files[0];
        if (file) {
            this.processFile(file);
        }
    }

    async processFile(file) {
        this.showLoading();
        
        try {
            // Preliminary size check
            if (file.size > 150 * 1024 * 1024) { // 150MB server limit
                throw new Error('File too large (maximum 150MB for analysis)');
            }

            // Send video to server for FFmpeg analysis
            const analysisResult = await this.analyzeVideoOnServer(file);
            
            this.displayResults(file, analysisResult.videoInfo, analysisResult.validation);
            
        } catch (error) {
            console.error('Processing error:', error);
            this.showError(error.message || 'Error analyzing video');
        }
    }

    async analyzeVideoOnServer(file) {
        const formData = new FormData();
        formData.append('video', file);

        const response = await fetch(`${this.serverUrl}/analyze-video`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Server error: ${response.status}`);
        }

        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.error || 'Analysis error');
        }

        return result;
    }

    displayResults(file, videoInfo, validationResults) {
        this.hideLoading();
        
        // Create validation table with real server values
        const tableHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Criterion</th>
                        <th>Required</th>
                        <th>Your Video</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.createTableRow('Resolution', validationResults.resolution)}
                    ${this.createTableRow('Format', validationResults.format)}
                    ${this.createTableRow('File Size', validationResults.fileSize)}
                    ${this.createTableRow('Frame Rate', validationResults.frameRate)}
                    ${this.createTableRow('Frame Count', validationResults.frameCount)}
                    ${this.createTableRow('Codec', validationResults.codec)}
                </tbody>
            </table>
        `;
        
        // Final result
        const finalStatusClass = validationResults.overall ? 'pass' : 'fail';
        const finalStatusIcon = validationResults.overall ? '🎉' : '❌';
        const finalStatusText = validationResults.overall 
            ? 'Video COMPLIANT with contest rules!' 
            : 'Video NOT COMPLIANT - See details above';
            
        this.validationTable.innerHTML = `
            <div class="final-status ${finalStatusClass}">
                ${finalStatusIcon} ${finalStatusText}
            </div>
            ${tableHTML}
        `;
        
        // Technical video details
        this.videoDetails.innerHTML = `
            <h3>🔍 Detailed Technical Analysis</h3>
            <div class="details-grid">
                <div class="detail-item">
                    <strong>File Name</strong>
                    <span>${file.name}</span>
                </div>
                <div class="detail-item">
                    <strong>File Size</strong>
                    <span>${validationResults.fileSize.value}</span>
                </div>
                <div class="detail-item">
                    <strong>Exact Duration</strong>
                    <span>${videoInfo.duration}s</span>
                </div>
                <div class="detail-item">
                    <strong>Resolution</strong>
                    <span>${videoInfo.width}×${videoInfo.height}px</span>
                </div>
                <div class="detail-item">
                    <strong>Exact Frame Rate</strong>
                    <span>${videoInfo.frameRate} fps</span>
                </div>
                <div class="detail-item">
                    <strong>Exact Frame Count</strong>
                    <span>${videoInfo.frameCount} frames</span>
                </div>
                <div class="detail-item">
                    <strong>Codec</strong>
                    <span>${videoInfo.codec}</span>
                </div>
                <div class="detail-item">
                    <strong>Container Format</strong>
                    <span>${videoInfo.format}</span>
                </div>
                ${videoInfo.bitRate ? `
                <div class="detail-item">
                    <strong>Bitrate</strong>
                    <span>${Math.round(videoInfo.bitRate / 1000)} kbps</span>
                </div>
                ` : ''}
            </div>
            <div class="info-note success">
                <strong>✅ Complete FFmpeg Analysis:</strong><br>
                All displayed values are <strong>exact</strong> and extracted directly from video metadata using FFmpeg. 
                No estimations are used.
            </div>
        `;
        
        this.results.style.display = 'block';
        this.results.scrollIntoView({ behavior: 'smooth' });
    }

    createTableRow(criterion, result) {
        const statusClass = result.valid ? 'status-valid' : 'status-invalid';
        const statusIcon = result.valid ? '✅' : '❌';
        
        return `
            <tr>
                <td>
                    <div class="criterion-name">${criterion}</div>
                </td>
                <td>${result.requirement}</td>
                <td><strong>${result.value}</strong></td>
                <td>
                    <span class="status-icon ${statusClass}">${statusIcon}</span>
                </td>
            </tr>
        `;
    }

    showError(message) {
        this.hideLoading();
        this.validationTable.innerHTML = `
            <div class="final-status fail">
                ❌ ${message}
            </div>
        `;
        this.videoDetails.innerHTML = `
            <div class="info-note error">
                <strong>🔧 Check that:</strong><br>
                • Node.js server is running<br>
                • FFmpeg is installed on server<br>
                • File is a valid video (MP4/MOV)<br>
                • Size doesn't exceed 150MB
            </div>
        `;
        this.results.style.display = 'block';
    }

    showLoading() {
        this.uploadArea.style.display = 'none';
        this.results.style.display = 'none';
        this.loading.style.display = 'block';
    }

    hideLoading() {
        this.loading.style.display = 'none';
    }

    reset() {
        this.uploadArea.style.display = 'block';
        this.results.style.display = 'none';
        this.fileInput.value = '';
    }
}

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    new VideoChecker();
});
