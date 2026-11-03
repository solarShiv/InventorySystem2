const axios = require("axios");

const apiRequest = async (api, apiMethod, data) => {
    try {
        const response = await axios({
            url: api,
            method: apiMethod,
            data: data,
            headers: {
                "Content-Type": "application/json",
            },
        });

        return response.data;

    } catch (error) {
        console.error("API Request Error:", error.response?.data || error.message);

        throw error;
    }
};

module.exports = apiRequest;