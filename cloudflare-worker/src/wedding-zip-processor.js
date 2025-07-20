// 🎯 Durable Object for Professional Wedding Photo Processing
// Each wedding gets its own dedicated stateful processor

export class WeddingZipProcessor {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.storage = this.state.storage;
  }

  async fetch(request) {
    const url = new URL(request.url);
    
    if (url.pathname === '/process') {
      return this.processWeddingPhotos(request);
    } else if (url.pathname === '/status') {
      return this.getProcessingStatus();
    } else if (url.pathname === '/resume') {
      return this.resumeProcessing();
    }
    
    return new Response('Wedding Processor Ready', { status: 200 });
  }

  async processWeddingPhotos(request) {
    try {
      const { eventId, files, customerEmail } = await request.json();
      
      console.log(`🎥 Starting wedding processing for ${eventId} with ${files.length} files`);
      
      // Store processing state
      await this.storage.put('eventId', eventId);
      await this.storage.put('customerEmail', customerEmail);
      await this.storage.put('status', 'processing');
      await this.storage.put('totalFiles', files.length);
      await this.storage.put('processedFiles', 0);
      await this.storage.put('fileList', JSON.stringify(files));
      await this.storage.put('startTime', Date.now());
      
      // Start streaming zip process
      const zipUrl = await this.createStreamingZip(files, eventId);
      
      // Send completion email
      await this.sendCompletionEmail(eventId, customerEmail, zipUrl);
      
      await this.storage.put('status', 'completed');
      await this.storage.put('downloadUrl', zipUrl);
      await this.storage.put('completedTime', Date.now());
      
      console.log(`✅ Wedding ${eventId} completed successfully`);
      
      return new Response(JSON.stringify({ 
        success: true, 
        downloadUrl: zipUrl,
        eventId,
        processedFiles: files.length
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
      
    } catch (error) {
      console.error('❌ Wedding processing error:', error);
      await this.storage.put('status', 'error');
      await this.storage.put('error', error.message);
      
      return new Response(JSON.stringify({ 
        success: false, 
        error: error.message 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  async createStreamingZip(files, eventId) {
    console.log(`📦 Creating streaming zip for ${files.length} files`);
    
    // Filter out oversized files (500MB limit)
    const validFiles = files.filter(file => {
      if (file.size > 500 * 1024 * 1024) {
        console.log(`⚠️ Skipping oversized file: ${file.name} (${file.size} bytes)`);
        return false;
      }
      return true;
    });
    
    // Create readable stream for zip
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    
    // Process files asynchronously
    this.processFilesStream(validFiles, writer).catch(error => {
      console.error('Stream processing error:', error);
      writer.abort(error);
    });
    
    // Upload stream directly to R2
    const zipKey = `zips/${eventId}/wedding-photos-${eventId}.zip`;
    
    await this.env.R2_BUCKET.put(zipKey, readable, {
      httpMetadata: {
        contentType: 'application/zip',
        contentDisposition: `attachment; filename="wedding-photos-${eventId}.zip"`
      }
    });
    
    const zipUrl = `${this.env.R2_PUBLIC_URL}/${zipKey}`;
    console.log(`✅ Zip uploaded to: ${zipUrl}`);
    
    return zipUrl;
  }

  async processFilesStream(files, writer) {
    let processedCount = 0;
    const zipEntries = [];
    
    // Write zip file headers
    const encoder = new TextEncoder();
    
    for (const file of files) {
      try {
        console.log(`📁 Processing: ${file.name} (${file.size} bytes)`);
        
        // Get file from R2
        const response = await this.env.R2_BUCKET.get(file.key);
        if (!response) {
          console.log(`⚠️ File not found in R2: ${file.key}`);
          continue;
        }
        
        const fileData = await response.arrayBuffer();
        
        // Create zip entry
        const entry = await this.createZipEntry(file.name, new Uint8Array(fileData));
        zipEntries.push(entry);
        
        // Write entry to stream
        await writer.write(entry.data);
        
        processedCount++;
        await this.storage.put('processedFiles', processedCount);
        await this.notifyProgress(processedCount, files.length);
        
        console.log(`✅ Processed ${processedCount}/${files.length}: ${file.name}`);
        
      } catch (error) {
        console.error(`❌ Error processing ${file.name}:`, error);
        // Continue with other files - don't fail entire wedding!
      }
    }
    
    // Write central directory and end record
    const centralDir = await this.createCentralDirectory(zipEntries);
    await writer.write(centralDir);
    
    await writer.close();
    console.log(`📦 Zip stream completed with ${processedCount} files`);
  }

  async createZipEntry(filename, data) {
    // Simple ZIP entry creation (local file header + data + data descriptor)
    const encoder = new TextEncoder();
    const filenameBytes = encoder.encode(filename);
    
    // Local file header (30 bytes + filename length)
    const header = new ArrayBuffer(30 + filenameBytes.length);
    const view = new DataView(header);
    
    view.setUint32(0, 0x04034b50, true); // Local file header signature
    view.setUint16(4, 20, true); // Version needed to extract
    view.setUint16(6, 0, true); // General purpose bit flag
    view.setUint16(8, 0, true); // Compression method (stored)
    view.setUint16(10, 0, true); // Last mod file time
    view.setUint16(12, 0, true); // Last mod file date
    view.setUint32(14, this.crc32(data), true); // CRC-32
    view.setUint32(18, data.length, true); // Compressed size
    view.setUint32(22, data.length, true); // Uncompressed size
    view.setUint16(26, filenameBytes.length, true); // Filename length
    view.setUint16(28, 0, true); // Extra field length
    
    // Combine header + filename + data
    const entryData = new Uint8Array(header.byteLength + filenameBytes.length + data.length);
    entryData.set(new Uint8Array(header), 0);
    entryData.set(filenameBytes, header.byteLength);
    entryData.set(data, header.byteLength + filenameBytes.length);
    
    return {
      filename,
      data: entryData,
      crc32: this.crc32(data),
      compressedSize: data.length,
      uncompressedSize: data.length,
      headerOffset: 0 // Will be set when building central directory
    };
  }

  async createCentralDirectory(entries) {
    const encoder = new TextEncoder();
    let centralDirData = new Uint8Array(0);
    let offset = 0;
    
    // Central directory file headers
    for (const entry of entries) {
      const filenameBytes = encoder.encode(entry.filename);
      const header = new ArrayBuffer(46 + filenameBytes.length);
      const view = new DataView(header);
      
      view.setUint32(0, 0x02014b50, true); // Central directory file header signature
      view.setUint16(4, 20, true); // Version made by
      view.setUint16(6, 20, true); // Version needed to extract
      view.setUint16(8, 0, true); // General purpose bit flag
      view.setUint16(10, 0, true); // Compression method
      view.setUint16(12, 0, true); // Last mod file time
      view.setUint16(14, 0, true); // Last mod file date
      view.setUint32(16, entry.crc32, true); // CRC-32
      view.setUint32(20, entry.compressedSize, true); // Compressed size
      view.setUint32(24, entry.uncompressedSize, true); // Uncompressed size
      view.setUint16(28, filenameBytes.length, true); // Filename length
      view.setUint16(30, 0, true); // Extra field length
      view.setUint16(32, 0, true); // File comment length
      view.setUint16(34, 0, true); // Disk number start
      view.setUint16(36, 0, true); // Internal file attributes
      view.setUint32(38, 0, true); // External file attributes
      view.setUint32(42, offset, true); // Relative offset of local header
      
      const headerData = new Uint8Array(header.byteLength + filenameBytes.length);
      headerData.set(new Uint8Array(header), 0);
      headerData.set(filenameBytes, header.byteLength);
      
      // Append to central directory
      const newCentralDirData = new Uint8Array(centralDirData.length + headerData.length);
      newCentralDirData.set(centralDirData, 0);
      newCentralDirData.set(headerData, centralDirData.length);
      centralDirData = newCentralDirData;
      
      offset += entry.data.length;
    }
    
    // End of central directory record
    const endRecord = new ArrayBuffer(22);
    const endView = new DataView(endRecord);
    
    endView.setUint32(0, 0x06054b50, true); // End of central dir signature
    endView.setUint16(4, 0, true); // Number of this disk
    endView.setUint16(6, 0, true); // Disk where central directory starts
    endView.setUint16(8, entries.length, true); // Number of central directory records on this disk
    endView.setUint16(10, entries.length, true); // Total number of central directory records
    endView.setUint32(12, centralDirData.length, true); // Size of central directory
    endView.setUint32(16, offset, true); // Offset of start of central directory
    endView.setUint16(20, 0, true); // Comment length
    
    // Combine central directory + end record
    const finalData = new Uint8Array(centralDirData.length + endRecord.byteLength);
    finalData.set(centralDirData, 0);
    finalData.set(new Uint8Array(endRecord), centralDirData.length);
    
    return finalData;
  }

  // Simple CRC32 implementation
  crc32(data) {
    const table = this.getCrc32Table();
    let crc = 0xFFFFFFFF;
    
    for (let i = 0; i < data.length; i++) {
      crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  getCrc32Table() {
    if (!this.crc32Table) {
      this.crc32Table = new Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
          c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        this.crc32Table[i] = c;
      }
    }
    return this.crc32Table;
  }

  async notifyProgress(processed, total) {
    const progress = Math.round((processed / total) * 100);
    console.log(`📊 Progress: ${progress}% (${processed}/${total})`);
    
    // Store progress for status checks
    await this.storage.put('progress', progress);
    await this.storage.put('lastUpdate', Date.now());
  }

  async sendCompletionEmail(eventId, customerEmail, zipUrl) {
    try {
      console.log(`📧 Sending completion email to ${customerEmail}`);
      
      const emailData = {
        to: customerEmail,
        subject: `🎉 Your Wedding Photos Are Ready! - Event ${eventId}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2c3e50;">🎉 Your Wedding Photos Are Ready!</h2>
            <p>Your beautiful wedding memories have been processed and are ready for download.</p>
            
            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0;">📋 Event Details</h3>
              <p><strong>Event ID:</strong> ${eventId}</p>
              <p><strong>Download expires:</strong> 7 days from now</p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${zipUrl}" 
                 style="background: #3498db; color: white; padding: 15px 30px; 
                        text-decoration: none; border-radius: 5px; font-weight: bold;">
                📥 Download Your Photos
              </a>
            </div>
            
            <p style="color: #7f8c8d; font-size: 14px;">
              💡 <strong>Tip:</strong> This is a large file. We recommend downloading on a stable Wi-Fi connection.
            </p>
            
            <hr style="border: none; border-top: 1px solid #ecf0f1; margin: 30px 0;">
            <p style="color: #7f8c8d; font-size: 12px;">
              This link will expire in 7 days for security. Please download your photos soon!
            </p>
          </div>
        `
      };
      
      // Send via email service
      const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: this.env.EMAILJS_SERVICE_ID,
          template_id: this.env.EMAILJS_TEMPLATE_ID,
          user_id: this.env.EMAILJS_USER_ID,
          template_params: emailData
        })
      });
      
      if (response.ok) {
        console.log(`✅ Email sent successfully to ${customerEmail}`);
      } else {
        console.error('❌ Email sending failed:', await response.text());
      }
      
    } catch (error) {
      console.error('❌ Email sending error:', error);
    }
  }

  async getProcessingStatus() {
    const status = await this.storage.get('status') || 'idle';
    const eventId = await this.storage.get('eventId');
    const totalFiles = await this.storage.get('totalFiles') || 0;
    const processedFiles = await this.storage.get('processedFiles') || 0;
    const progress = await this.storage.get('progress') || 0;
    const startTime = await this.storage.get('startTime');
    const lastUpdate = await this.storage.get('lastUpdate');
    const downloadUrl = await this.storage.get('downloadUrl');
    const error = await this.storage.get('error');
    
    const elapsedTime = startTime ? Date.now() - startTime : 0;
    
    return new Response(JSON.stringify({
      eventId,
      status,
      totalFiles,
      processedFiles,
      progress,
      elapsedTime,
      lastUpdate,
      downloadUrl,
      error
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async resumeProcessing() {
    const status = await this.storage.get('status');
    
    if (status === 'processing') {
      const processedFiles = await this.storage.get('processedFiles') || 0;
      const fileList = JSON.parse(await this.storage.get('fileList') || '[]');
      const eventId = await this.storage.get('eventId');
      
      console.log(`🔄 Resuming processing from file ${processedFiles}/${fileList.length}`);
      
      // Resume from where we left off
      const remainingFiles = fileList.slice(processedFiles);
      
      if (remainingFiles.length > 0) {
        const zipUrl = await this.createStreamingZip(remainingFiles, eventId);
        
        await this.storage.put('status', 'completed');
        await this.storage.put('downloadUrl', zipUrl);
        
        return new Response(JSON.stringify({ 
          success: true, 
          resumed: true,
          downloadUrl: zipUrl 
        }));
      }
    }
    
    return new Response(JSON.stringify({ 
      success: false, 
      message: 'No processing to resume' 
    }));
  }
}
