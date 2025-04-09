//  my code working 
 const express = require("express");
 const {
     getGlobalSummary,
     getGlobalDetails,
     getRegionSummary,
     getRegionDetails,
 } = require("../controllers/regionControllers");
 
 const router = express.Router();
 
 // Global Routes
 router.get("/summary/global", getGlobalSummary);
 router.get("/details/global", getGlobalDetails);
 
 
 // Region Routes
 router.get("/summary/:regionName", getRegionSummary);
 router.get("/details/:regionName", getRegionDetails)
 
 module.exports = router;


