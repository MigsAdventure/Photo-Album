import { collection, query, where, getDocs, limit, startAfter } from 'firebase/firestore';
import { db } from '../firebase';
import { migrateBatchToR2 } from '../services/r2Service';

// Migrate all photos for a specific event
export const migrateEventToR2 = async (
  eventId: string,
  onProgress?: (processed: number, total: number, current?: string) => void
): Promise<{ success: number; failed: number; total: number }> => {
  console.log('🚀 Starting R2 migration for event:', eventId);
  
  // Get all photos for this event
  const q = query(
    collection(db, 'photos'),
    where('eventId', '==', eventId)
  );
  
  const snapshot = await getDocs(q);
  const photos: any[] = [];
  
  snapshot.forEach((doc) => {
    const data = doc.data();
    photos.push({
      id: doc.id,
      ...data
    });
  });
  
  console.log(`📊 Found ${photos.length} photos to migrate for event:`, eventId);
  
  if (photos.length === 0) {
    return { success: 0, failed: 0, total: 0 };
  }
  
  // Filter out photos that already have R2 keys
  const photosNeedingMigration = photos.filter(photo => {
    const hasR2Key = photo.r2Key && typeof photo.r2Key === 'string' && photo.r2Key.trim().length > 0;
    return !hasR2Key;
  });
  
  console.log(`📦 ${photosNeedingMigration.length} photos need R2 migration (${photos.length - photosNeedingMigration.length} already migrated)`);
  
  if (photosNeedingMigration.length === 0) {
    console.log('✅ All photos already migrated to R2');
    return { success: photos.length, failed: 0, total: photos.length };
  }
  
  let totalSuccess = 0;
  let totalFailed = 0;
  const batchSize = 5; // Process in small batches to avoid overwhelming services
  
  // Process in batches
  for (let i = 0; i < photosNeedingMigration.length; i += batchSize) {
    const batch = photosNeedingMigration.slice(i, i + batchSize);
    
    console.log(`📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(photosNeedingMigration.length / batchSize)}`);
    
    // Update progress
    onProgress?.(i, photosNeedingMigration.length, `Migrating batch ${Math.floor(i / batchSize) + 1}...`);
    
    // Migrate batch
    const result = await migrateBatchToR2(batch);
    totalSuccess += result.success;
    totalFailed += result.failed;
    
    // Small delay between batches
    if (i + batchSize < photosNeedingMigration.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  // Final progress update
  onProgress?.(photosNeedingMigration.length, photosNeedingMigration.length, 'Migration completed');
  
  console.log(`✅ Event migration completed:`, {
    eventId,
    totalPhotos: photos.length,
    needingMigration: photosNeedingMigration.length,
    successful: totalSuccess,
    failed: totalFailed,
    alreadyMigrated: photos.length - photosNeedingMigration.length
  });
  
  return { 
    success: totalSuccess + (photos.length - photosNeedingMigration.length), // Include already migrated
    failed: totalFailed, 
    total: photos.length 
  };
};

// Migrate all photos in the database (paginated for large datasets)
export const migrateAllPhotosToR2 = async (
  onProgress?: (processed: number, estimated: number, current?: string) => void
): Promise<{ success: number; failed: number; total: number }> => {
  console.log('🌍 Starting global R2 migration...');
  
  let totalSuccess = 0;
  let totalFailed = 0;
  let totalProcessed = 0;
  let hasMore = true;
  let lastDoc: any = null;
  const pageSize = 20;
  
  while (hasMore) {
    // Build query with pagination
    let q = query(
      collection(db, 'photos'),
      limit(pageSize)
    );
    
    if (lastDoc) {
      q = query(
        collection(db, 'photos'),
        startAfter(lastDoc),
        limit(pageSize)
      );
    }
    
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      hasMore = false;
      break;
    }
    
    const photos: any[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      photos.push({
        id: doc.id,
        ...data
      });
    });
    
    // Filter photos that need migration
    const photosNeedingMigration = photos.filter(photo => {
      const hasR2Key = photo.r2Key && typeof photo.r2Key === 'string' && photo.r2Key.trim().length > 0;
      return !hasR2Key;
    });
    
    console.log(`📄 Page: ${photos.length} photos, ${photosNeedingMigration.length} need migration`);
    
    if (photosNeedingMigration.length > 0) {
      // Update progress
      onProgress?.(
        totalProcessed, 
        totalProcessed + 100, // Rough estimate
        `Migrating ${photosNeedingMigration.length} photos from page...`
      );
      
      // Migrate this batch
      const result = await migrateBatchToR2(photosNeedingMigration);
      totalSuccess += result.success;
      totalFailed += result.failed;
    }
    
    totalProcessed += photos.length;
    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    
    // Check if we have more pages
    if (photos.length < pageSize) {
      hasMore = false;
    }
  }
  
  onProgress?.(totalProcessed, totalProcessed, 'Global migration completed');
  
  console.log('🌍 Global migration completed:', {
    totalProcessed,
    totalSuccess,
    totalFailed
  });
  
  return { success: totalSuccess, failed: totalFailed, total: totalProcessed };
};

// Get migration status for an event
export const getEventMigrationStatus = async (eventId: string): Promise<{
  total: number;
  migrated: number;
  needsMigration: number;
  percentage: number;
}> => {
  const q = query(
    collection(db, 'photos'),
    where('eventId', '==', eventId)
  );
  
  const snapshot = await getDocs(q);
  let total = 0;
  let migrated = 0;
  
  snapshot.forEach((doc) => {
    const data = doc.data();
    total++;
    
    const hasR2Key = data.r2Key && typeof data.r2Key === 'string' && data.r2Key.trim().length > 0;
    if (hasR2Key) {
      migrated++;
    }
  });
  
  const needsMigration = total - migrated;
  const percentage = total > 0 ? Math.round((migrated / total) * 100) : 100;
  
  return {
    total,
    migrated,
    needsMigration,
    percentage
  };
};

// Get global migration status
export const getGlobalMigrationStatus = async (): Promise<{
  total: number;
  migrated: number;
  needsMigration: number;
  percentage: number;
}> => {
  // This is a simplified version - for large datasets, you'd want pagination
  const snapshot = await getDocs(collection(db, 'photos'));
  let total = 0;
  let migrated = 0;
  
  snapshot.forEach((doc) => {
    const data = doc.data();
    total++;
    
    const hasR2Key = data.r2Key && typeof data.r2Key === 'string' && data.r2Key.trim().length > 0;
    if (hasR2Key) {
      migrated++;
    }
  });
  
  const needsMigration = total - migrated;
  const percentage = total > 0 ? Math.round((migrated / total) * 100) : 100;
  
  return {
    total,
    migrated,
    needsMigration,
    percentage
  };
};
