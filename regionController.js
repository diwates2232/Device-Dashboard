

const { fetchGlobalData, fetchRegionData} = require("../services/excelService");


// Global Summary Controller
const getGlobalSummary = async (req, res) => {
    try {
        const globalData = await fetchGlobalData();
        res.status(200).json({ summary: globalData.summary });
    } catch (error) {
        res.status(500).json({ error: "Internal server error", details: error.message });
    }
};

// Global Details Controller
const getGlobalDetails = async (req, res) => {
    try {
        const globalData = await fetchGlobalData();
        res.status(200).json({ details: globalData.details });
    } catch (error) {
        res.status(500).json({ error: "Internal server error", details: error.message });
    }
};

// Region Summary Controller
const getRegionSummary = async (req, res) => {
    const { regionName } = req.params;
    try {
        const regionData = await fetchRegionData(regionName);
        res.status(200).json({ summary: regionData.summary });
    } catch (error) {
        res.status(500).json({ error: "Internal server error", details: error.message });
    }
};


// Region Details Controller
const getRegionDetails = async (req, res) => {
    const { regionName } = req.params;
    try {
        const regionData = await fetchRegionData(regionName);
        res.status(200).json({ details: regionData.details });
    } catch (error) {
        res.status(500).json({ error: "Internal server error", details: error.message });
    }
};

module.exports = {
    getGlobalSummary,
    getGlobalDetails,
    getRegionSummary,
    getRegionDetails,
};

