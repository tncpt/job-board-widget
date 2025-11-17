/**
 * The main function that runs when the web app URL is visited.
 * It fetches job data from the spreadsheet and returns it as JSONP.
 */
function doGet(e) {
  const sheetName = "DB";
  
  try {
    // The callback function name is passed as a URL parameter.
    // e.g., ?callback=handleJobData
    const callback = e?.parameter?.callback;
    if (!callback) throw new Error("A 'callback' parameter is required for JSONP.");

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
      "Job Level", "NC101 Share Date", "Summary", "Expired"
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
      });
    });

    const jsonData = JSON.stringify(jobs);
    const jsonpOutput = `${callback}(${jsonData})`;

    // For JSONP, the MIME type must be JAVASCRIPT.
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