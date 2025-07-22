const { LambdaClient, ListFunctionsCommand, GetFunctionCommand } = require('@aws-sdk/client-lambda');

// Initialize Lambda client
const lambdaClient = new LambdaClient({ region: 'us-east-1' });

async function listLambdaFunctions() {
  try {
    console.log('Listing Lambda functions...');
    
    const command = new ListFunctionsCommand({});
    const response = await lambdaClient.send(command);
    
    if (response.Functions && response.Functions.length > 0) {
      console.log(`Found ${response.Functions.length} Lambda functions:`);
      
      // Sort by last modified date
      const sortedFunctions = response.Functions.sort((a, b) => 
        new Date(b.LastModified) - new Date(a.LastModified)
      );
      
      sortedFunctions.forEach(func => {
        console.log(`- ${func.FunctionName} (Runtime: ${func.Runtime}, Last Modified: ${func.LastModified})`);
      });
      
      return sortedFunctions;
    } else {
      console.log('No Lambda functions found');
      return [];
    }
  } catch (error) {
    console.error('Error listing Lambda functions:', error);
    return [];
  }
}

async function getLambdaFunctionDetails(functionName) {
  try {
    console.log(`\nGetting details for Lambda function: ${functionName}`);
    
    const command = new GetFunctionCommand({
      FunctionName: functionName
    });
    
    const response = await lambdaClient.send(command);
    
    console.log('Function details:');
    console.log(`- Name: ${response.Configuration.FunctionName}`);
    console.log(`- ARN: ${response.Configuration.FunctionArn}`);
    console.log(`- Runtime: ${response.Configuration.Runtime}`);
    console.log(`- Handler: ${response.Configuration.Handler}`);
    console.log(`- Memory: ${response.Configuration.MemorySize} MB`);
    console.log(`- Timeout: ${response.Configuration.Timeout} seconds`);
    console.log(`- Last Modified: ${response.Configuration.LastModified}`);
    console.log(`- Environment Variables: ${response.Configuration.Environment ? 'Yes' : 'No'}`);
    
    if (response.Configuration.Environment && response.Configuration.Environment.Variables) {
      console.log('- Environment Variable Keys:');
      Object.keys(response.Configuration.Environment.Variables).forEach(key => {
        console.log(`  - ${key}`);
      });
    }
    
    return response.Configuration;
  } catch (error) {
    console.error(`Error getting Lambda function details for ${functionName}:`, error);
    return null;
  }
}

async function findWeddingPhotoLambda() {
  const functions = await listLambdaFunctions();
  
  // Look for functions related to wedding photos or EC2 launching
  const weddingFunctions = functions.filter(func => 
    func.FunctionName.toLowerCase().includes('wedding') || 
    func.FunctionName.toLowerCase().includes('photo') ||
    func.FunctionName.toLowerCase().includes('ec2') ||
    func.FunctionName.toLowerCase().includes('spot')
  );
  
  if (weddingFunctions.length > 0) {
    console.log('\nFound potential wedding photo related Lambda functions:');
    weddingFunctions.forEach(func => {
      console.log(`- ${func.FunctionName}`);
    });
    
    // Get details for each potential function
    for (const func of weddingFunctions) {
      await getLambdaFunctionDetails(func.FunctionName);
    }
  } else {
    console.log('\nNo wedding photo related Lambda functions found');
  }
}

findWeddingPhotoLambda();