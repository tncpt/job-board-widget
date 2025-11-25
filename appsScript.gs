/* ---------------- BEGIN Cache helpers for chunked storage ---------------- */
const CACHE_INDEX_KEY = 'circle-jobs-keys';
const CACHE_CHUNK_PREFIX = 'circle-jobs-chunk-';
const CHUNK_TARGET_BYTES = 85 * 1024; // target ~85KB per chunk
const CHUNK_MAX_BYTES = 100 * 1024; // absolute max per CacheService entry
const DEFAULT_CACHE_TTL = 4 * 60 * 60; // 4 hours in seconds

function cacheJobData(jobs, ttlSec) {
  const cache = CacheService.getScriptCache();
  const keys = [];
  let chunk = [];

  function writeChunk(chunkToWrite) {
    const chunkStr = JSON.stringify(chunkToWrite);
    const key = CACHE_CHUNK_PREFIX + keys.length;
    cache.put(key, chunkStr, ttlSec);
    keys.push(key);
  }

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const testChunk = chunk.concat([job]);
    const testStr = JSON.stringify(testChunk);
    const testBytes = Utilities.newBlob(testStr).getBytes().length;

    if (testBytes > CHUNK_MAX_BYTES) {
      if (chunk.length === 0)
        throw new Error('Single job exceeds cache chunk maximum size (100KB)');

      writeChunk(chunk);
      chunk = [job];
    } else if (testBytes > CHUNK_TARGET_BYTES && chunk.length > 0) {
      writeChunk(chunk);
      chunk = [job];
    } else {
      chunk = testChunk;
    }
  }

  // Write any remaining chunk
  if (chunk.length > 0) {
    const chunkBytes = Utilities.newBlob(JSON.stringify(chunk)).getBytes().length;
    if (chunkBytes > CHUNK_MAX_BYTES)
      throw new Error('Final chunk exceeds maximum cache size (100KB)');

    writeChunk(chunk);
  }

  // Store the index of keys
  cache.put(CACHE_INDEX_KEY, JSON.stringify(keys), ttlSec);
  return keys;
}

function clearJobCache(keys) {
  const cache = CacheService.getScriptCache();
  try { cache.remove(CACHE_INDEX_KEY); } catch (e) {}
  if (Array.isArray(keys))
    keys.forEach(k => {
      try { cache.remove(k); } catch (e) {}
    });
}

function getCachedJobs() {
  const cache = CacheService.getScriptCache();
  const indexStr = cache.get(CACHE_INDEX_KEY);
  if (!indexStr) return null;

  let keys;
  try { keys = JSON.parse(indexStr); } catch (e) { return null; }
  if (!Array.isArray(keys) || keys.length === 0) return null;

  const results = [];
  for (let i = 0; i < keys.length; i++) {
    const chunkStr = cache.get(keys[i]);
    if (!chunkStr) {
      clearJobCache(keys);
      return null;
    }

    try {
      const arr = JSON.parse(chunkStr);
      if (Array.isArray(arr)) results.push.apply(results, arr);
      else {
        clearJobCache(keys);
        return null;
      }
    } catch (e) {
      clearJobCache(keys);
      return null;
    }
  }

  return results;
}

/**
 * The main function that runs when the web app URL is visited.
 * It fetches job data from the spreadsheet and returns it as JSONP.
 */
function doGet(e) {
  const sheetName = "DB";

  try {
    // Debug endpoint to check cache status (e.g., ?debug=cache)
    if (e?.parameter?.debug === 'cache') {
      const cache = CacheService.getScriptCache();
      const indexStr = cache.get(CACHE_INDEX_KEY);
      let keys = [];
      let chunkSizes = [];

      if (indexStr) {
        try {
          keys = JSON.parse(indexStr);
          keys.forEach(key => {
            const chunkStr = cache.get(key);
            if (chunkStr) {
              const bytes = Utilities.newBlob(chunkStr).getBytes().length;
              chunkSizes.push({ key: key, sizeKB: (bytes / 1024).toFixed(2) });
            } else {
              chunkSizes.push({ key: key, sizeKB: 'missing' });
            }
          });
        } catch (e) {}
      }

      return ContentService.createTextOutput(JSON.stringify({
        hasIndex: !!indexStr,
        chunkCount: keys.length,
        chunkKeys: keys,
        chunkSizes: chunkSizes,
        timestamp: new Date().toISOString()
      }, null, 2)).setMimeType(ContentService.MimeType.JSON);
    }

    // The callback function name is passed as a URL parameter (e.g., ?callback=handleJobData)
    const callback = e?.parameter?.callback;
    if (!callback) throw new Error("A 'callback' parameter is required for JSONP.");

    const cached = getCachedJobs();
    if (cached) {
      const jsonData = JSON.stringify(cached);
      const jsonpOutput = `${callback}(${jsonData})`;
      return ContentService.createTextOutput(jsonpOutput)
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!sheet) throw new Error(`Sheet "${sheetName}" not found.`);

    const data = sheet.getDataRange().getValues();
    const headers = data.shift();

    const headerMap = {};
    headers.forEach((header, index) => {
      headerMap[header] = index;
    });

    const requiredHeaders = [
      "Universal ID", "Job Title", "Company Name", "Job Location",
      "Job Level", "NC101 Share Date", "Summary", "Expired", "Circle URL"
    ];

    for (const header of requiredHeaders) {
      if (headerMap[header] === undefined) {
        throw new Error(`Required column "${header}" not found in the sheet.`);
      }
    }

    const jobs = [];
    const typeKeywords = ["Contract", "Contractor", "Part-time", "Part time", "Per-diem", "Per diem", "PRN"];

    data.forEach(row => {
      const isExpired = row[headerMap["Expired"]];
      if (isExpired) return;

      const jobTitle = row[headerMap["Job Title"]] || "";
      let jobType = "Full-time";

      for (const keyword of typeKeywords) {
        if (jobTitle.toLowerCase().includes(keyword.toLowerCase())) {
          if (keyword === "Part time") jobType = "Part-time";
          else if (keyword === "Per diem") jobType = "Per-diem";
          else jobType = keyword;
          break;
        }
      }

      let postedDate = "";
      const dateValue = row[headerMap["NC101 Share Date"]];
      if (dateValue instanceof Date) {
        postedDate = dateValue.toISOString().split('T')[0];
      }

      jobs.push({
        id: row[headerMap["Universal ID"]],
        title: row[headerMap["Job Title"]],
        company: row[headerMap["Company Name"]],
        location: row[headerMap["Job Location"]],
        type: jobType,
        level: row[headerMap["Job Level"]],
        postedDate,
        description: row[headerMap["Summary"]],
        skills: null,
        companyLogo: null,
        url: row[headerMap["Circle URL"]],
      });
    });

    try {
      cacheJobData(jobs, DEFAULT_CACHE_TTL);
    } catch (cacheErr) {
      // Swallow (but log) cache errors
      Logger.log('Cache error: ' + cacheErr.toString());
    }

    const jsonData = JSON.stringify(jobs);
    const jsonpOutput = `${callback}(${jsonData})`;

    return ContentService.createTextOutput(jsonpOutput)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);

  } catch (error) {
    Logger.log(error.toString());
    const errorJson = JSON.stringify({ error: error.message });

    if (e?.parameter?.callback) {
       return ContentService.createTextOutput(`${e.parameter.callback}(${errorJson})`)
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService.createTextOutput(errorJson)
      .setMimeType(ContentService.MimeType.JSON);
  }
}