import React, { useState } from 'react';
import { migrateEventToR2, getEventMigrationStatus } from '../utils/r2Migration';
import { testR2Connection } from '../services/r2Service';

interface MigrationStatus {
  total: number;
  migrated: number;
  needsMigration: number;
  percentage: number;
}

interface Props {
  eventId: string;
  onClose: () => void;
}

export const R2MigrationPanel: React.FC<Props> = ({ eventId, onClose }) => {
  const [migrationStatus, setMigrationStatus] = useState<MigrationStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isR2Connected, setIsR2Connected] = useState<boolean | null>(null);
  const [migrationProgress, setMigrationProgress] = useState<{
    processed: number;
    total: number;
    current?: string;
  } | null>(null);
  const [migrationResult, setMigrationResult] = useState<{
    success: number;
    failed: number;
    total: number;
  } | null>(null);

  // Test R2 connection
  const checkR2Connection = async () => {
    setIsLoading(true);
    try {
      const connected = await testR2Connection();
      setIsR2Connected(connected);
    } catch (error) {
      console.error('R2 connection test failed:', error);
      setIsR2Connected(false);
    } finally {
      setIsLoading(false);
    }
  };

  // Check migration status
  const checkMigrationStatus = async () => {
    setIsLoading(true);
    try {
      const status = await getEventMigrationStatus(eventId);
      setMigrationStatus(status);
    } catch (error) {
      console.error('Failed to check migration status:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Start migration
  const startMigration = async () => {
    setIsLoading(true);
    setMigrationProgress({ processed: 0, total: 0 });
    setMigrationResult(null);
    
    try {
      const result = await migrateEventToR2(eventId, (processed, total, current) => {
        setMigrationProgress({ processed, total, current });
      });
      
      setMigrationResult(result);
      
      // Refresh status after migration
      await checkMigrationStatus();
    } catch (error) {
      console.error('Migration failed:', error);
    } finally {
      setIsLoading(false);
      setMigrationProgress(null);
    }
  };

  React.useEffect(() => {
    checkMigrationStatus();
    checkR2Connection();
  }, [eventId]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">R2 Migration Panel</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl"
          >
            ×
          </button>
        </div>

        {/* R2 Connection Status */}
        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <h3 className="font-semibold mb-2">R2 Connection Status</h3>
          <div className="flex items-center gap-2">
            {isR2Connected === null ? (
              <span className="text-gray-500">Testing connection...</span>
            ) : isR2Connected ? (
              <>
                <span className="w-3 h-3 bg-green-500 rounded-full"></span>
                <span className="text-green-700">R2 Connected ✅</span>
              </>
            ) : (
              <>
                <span className="w-3 h-3 bg-red-500 rounded-full"></span>
                <span className="text-red-700">R2 Connection Failed ❌</span>
              </>
            )}
            <button
              onClick={checkR2Connection}
              className="ml-2 text-blue-600 text-sm hover:underline"
              disabled={isLoading}
            >
              Retest
            </button>
          </div>
        </div>

        {/* Migration Status */}
        {migrationStatus && (
          <div className="mb-6 p-4 bg-blue-50 rounded-lg">
            <h3 className="font-semibold mb-2">Event: {eventId}</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span>Total Photos:</span>
                <span className="font-mono">{migrationStatus.total}</span>
              </div>
              <div className="flex justify-between">
                <span>✅ Migrated to R2:</span>
                <span className="font-mono text-green-600">{migrationStatus.migrated}</span>
              </div>
              <div className="flex justify-between">
                <span>⏳ Needs Migration:</span>
                <span className="font-mono text-orange-600">{migrationStatus.needsMigration}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${migrationStatus.percentage}%` }}
                ></div>
              </div>
              <div className="text-center text-sm text-gray-600">
                {migrationStatus.percentage}% migrated
              </div>
            </div>
            
            <button
              onClick={checkMigrationStatus}
              className="mt-3 text-blue-600 text-sm hover:underline"
              disabled={isLoading}
            >
              Refresh Status
            </button>
          </div>
        )}

        {/* Migration Progress */}
        {migrationProgress && (
          <div className="mb-6 p-4 bg-yellow-50 rounded-lg">
            <h3 className="font-semibold mb-2">Migration in Progress...</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span>Progress:</span>
                <span className="font-mono">{migrationProgress.processed} / {migrationProgress.total}</span>
              </div>
              {migrationProgress.current && (
                <div className="text-sm text-gray-600">
                  {migrationProgress.current}
                </div>
              )}
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-yellow-500 h-2 rounded-full transition-all duration-300"
                  style={{ 
                    width: `${migrationProgress.total === 0 ? 0 : (migrationProgress.processed / migrationProgress.total) * 100}%` 
                  }}
                ></div>
              </div>
            </div>
          </div>
        )}

        {/* Migration Result */}
        {migrationResult && (
          <div className="mb-6 p-4 bg-green-50 rounded-lg">
            <h3 className="font-semibold mb-2">Migration Completed!</h3>
            <div className="space-y-1">
              <div className="flex justify-between">
                <span>✅ Successful:</span>
                <span className="font-mono text-green-600">{migrationResult.success}</span>
              </div>
              <div className="flex justify-between">
                <span>❌ Failed:</span>
                <span className="font-mono text-red-600">{migrationResult.failed}</span>
              </div>
              <div className="flex justify-between">
                <span>📊 Total:</span>
                <span className="font-mono">{migrationResult.total}</span>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3">
          {migrationStatus && migrationStatus.needsMigration > 0 && isR2Connected && (
            <button
              onClick={startMigration}
              disabled={isLoading}
              className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Migrating...' : `Migrate ${migrationStatus.needsMigration} Photos`}
            </button>
          )}
          
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Close
          </button>
        </div>

        {/* Info */}
        <div className="mt-4 p-3 bg-gray-100 rounded text-sm text-gray-600">
          <strong>How it works:</strong> New uploads go to Firebase first (reliable), then copy to R2 in background. 
          Downloads always use R2 for perfect headers. This migration copies existing Firebase photos to R2.
        </div>
      </div>
    </div>
  );
};
