// index.js
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const dotenv = require('dotenv');
const PDFDocument = require('pdfkit');
const csv = require('fast-csv');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');

const fs = require('fs');

dotenv.config();
const cors = require("cors")

const app = express();
const PORT = 4000;
app.use(cors())
// MongoDB connection string
const URL = process.env.DB;

// Connect to MongoDB
let db;

MongoClient.connect(URL)
  .then((client) => {
    db = client.db();
    console.log('Connected to MongoDB');
  })
  .catch((err) => console.error('Error connecting to MongoDB:', err));

// Middleware
app.use(express.json());
// API endpoint to add a new transaction
app.post('/api/transactions', async (req, res) => {
  const newTransaction = req.body;
  try {
    const result = await db.collection('transactions').insertOne(newTransaction);
    const savedTransaction = await db.collection('transactions').findOne({ _id: result.insertedId });
    res.status(201).json(savedTransaction);
    console.log(savedTransaction)
  } catch (error) {
    console.error('Error adding transaction:', error);

  }
});

// API endpoint to get all transactions
// API endpoint to get all transactions with optional sorting
app.get('/api/transactions', async (req, res) => {
  try {
    // Convert 'amount' field from string to number
    await db.collection('transactions').find({ amount: { $type: 'string' } }).forEach(async function (doc) {
      await db.collection('transactions').updateOne({ _id: doc._id }, { $set: { amount: parseFloat(doc.amount) } });
    });

    // Fetch transactions with sorting
    let sortBy = req.query.sortBy || 'date';
    const sortOrder = sortBy === 'date' ? -1 : 1; // -1 for descending, 1 for ascending
    const searchTerm = req.query.searchTerm || ''; // Extract search term from query

    let query = {};
    if (searchTerm) {
      // Case-insensitive search for the 'description' field
      query = { description: { $regex: new RegExp(searchTerm, 'i') } };
    }

    const transactions = await db.collection('transactions').find(query).sort({ [sortBy]: sortOrder }).toArray();

    res.json(transactions);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});
// API endpoint to edit a transaction

app.put('/api/transactions/:id', async (req, res) => {
  const { id } = req.params;
  const updatedTransaction = req.body;

  // Exclude the _id field from the update
  delete updatedTransaction._id;

  try {
    const result = await db
      .collection('transactions')
      .findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: updatedTransaction },
        { returnDocument: 'after' }
      );
    res.json(result.value);
  } catch (error) {
    console.error('Error updating transaction:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});


app.delete('/api/transactions/:id', async (req, res) => {
  const { id } = req.params;

  try {
    await db.collection('transactions').deleteOne({ _id: new ObjectId(id) });
    res.json({ message: 'Transaction deleted successfully' });
  } catch (error) {
    console.error('Error deleting transaction:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// API endpoint to get transaction summary
app.get('/api/transaction-summary', async (req, res) => {
  try {
    const summary = await db.collection('transactions').aggregate([
      {
        $group: {
          _id: null,
          totalIncome: { $sum: { $cond: { if: { $eq: ['$type', 'income'] }, then: { $toDouble: '$amount' }, else: 0 } } },
          totalExpense: { $sum: { $cond: { if: { $eq: ['$type', 'expense'] }, then: { $toDouble: '$amount' }, else: 0 } } },
          balance: { $sum: { $cond: { if: { $eq: ['$type', 'income'] }, then: { $toDouble: '$amount' }, else: { $multiply: [{ $toDouble: '$amount' }, -1] } } } },
        },
      },
    ]).toArray();

    // Extract summary values
    const transactionSummary = {
      totalIncome: summary[0]?.totalIncome || 0,
      totalExpense: summary[0]?.totalExpense || 0,
      balance: summary[0]?.balance || 0,
    };

    res.json(transactionSummary);
  } catch (error) {
    console.error('Error fetching transaction summary:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});
// New endpoint to handle different report types
// New endpoint to handle different report types
app.get('/api/transactions/report', async (req, res) => {
  try {
    let transactions;

    const reportType = req.query.type;
    let query = {};

    if (reportType === 'monthly') {
      const currentDate = new Date();
      const startOfMonth = `${currentDate.getFullYear()}-${(currentDate.getMonth() + 1).toString().padStart(2, '0')}-01`;
      const endOfMonth = `${currentDate.getFullYear()}-${(currentDate.getMonth() + 2).toString().padStart(2, '0')}-01`;

      transactions = await db.collection('transactions').find({
        date: { $gte: startOfMonth, $lt: endOfMonth }
      }).sort({ date: 1 }).toArray();
    } else if (reportType === 'yearly') {
      const startOfYear = `${new Date().getFullYear()}-01-01`;
      const endOfYear = `${new Date().getFullYear() + 1}-01-01`;

      transactions = await db.collection('transactions').find({
        date: { $gte: startOfYear, $lt: endOfYear }
      }).sort({ date: 1 }).toArray();
    } else if (reportType === 'custom') {
      const startDate = req.query.startDate; // Assuming startDate is in "YYYY-MM-DD" format
      const endDate = req.query.endDate;     // Assuming endDate is in "YYYY-MM-DD" format

      transactions = await db.collection('transactions').find({
        date: { $gte: startDate, $lt: endDate }
      }).sort({ date: 1 }).toArray();
    } else {
      transactions = await db.collection('transactions').find().sort({ date: 1 }).toArray();
    }

    res.json(transactions);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});




// API endpoint to export transactions as PDF, CSV, or for printing
app.get('/api/transactions/export', async (req, res) => {
  try {
    const { type, format } = req.query;
    let transactions;

    if (type === 'all') {
      transactions = await db.collection('transactions').find().toArray();
    } else if (type === 'monthly') {
      // Implement logic to fetch monthly transactions
      const currentDate = new Date();
      const startOfMonth = `${currentDate.getFullYear()}-${(currentDate.getMonth() + 1).toString().padStart(2, '0')}-01`;
      const endOfMonth = `${currentDate.getFullYear()}-${(currentDate.getMonth() + 2).toString().padStart(2, '0')}-01`;

      transactions = await db.collection('transactions').find({
        date: { $gte: startOfMonth, $lt: endOfMonth }
      }).toArray();
    } else if (type === 'yearly') {
      // Implement logic to fetch yearly transactions
      const startOfYear = `${new Date().getFullYear()}-01-01`;
      const endOfYear = `${new Date().getFullYear() + 1}-01-01`;

      transactions = await db.collection('transactions').find({
        date: { $gte: startOfYear, $lt: endOfYear }
      }).toArray();
    } else {
      const startDate = req.query.startDate; // Assuming startDate is in "YYYY-MM-DD" format
      const endDate = req.query.endDate;     // Assuming endDate is in "YYYY-MM-DD" format

      transactions = await db.collection('transactions').find({
        date: { $gte: startDate, $lt: endDate }
      }).toArray();
    }

    if (format === 'pdf') {
      // Create a PDF document
      const doc = new PDFDocument();
      const pdfBuffers = [];

      doc.on('data', buffer => pdfBuffers.push(buffer));
      doc.on('end', () => {
        const pdfBlob = Buffer.concat(pdfBuffers);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=report.pdf');
        res.send(pdfBlob);
      });

      doc.fontSize(16).text('Transaction Report', { align: 'center' });
      doc.moveDown();
      // Set up table header
      doc.font('Helvetica-Bold');
      doc.text('Description', 50, 180);
      doc.text('Amount', 300, 180);
      doc.text('Date', 450, 180);

      // Draw horizontal line under header
      doc.moveTo(50, 200).lineTo(550, 200).dash(3, { space: 2 }).stroke();

      	  // Draw table rows
      doc.font('Helvetica');
      	  let yPos = 200;
      transactions.forEach(transaction => {
        doc.text(transaction.description, 50, yPos + 20);
        doc.text(`${transaction.amount.toFixed(2)}`, 300, yPos + 20);
        doc.text(new Date(transaction.date).toLocaleDateString(), 450, yPos + 20);

        // Draw horizontal line between rows
        doc.moveTo(50, yPos + 40).lineTo(550, yPos + 40).dash(3, { space: 2 }).stroke();

        yPos += 40;
      });
      doc.end();

    } else if (format === 'csv') {
      // Create a CSV file
      const csvData = transactions.map(transaction => [
        transaction.date,
        transaction.description,
        transaction.amount.toString(), // Convert amount to string
      ]);
      
      const csvHeaders = ['Date', 'Description', 'Amount'];
      
      // Add headers to the CSV data
      const csvString = [csvHeaders.join(',')].concat(csvData.map(row => row.join(','))).join('\n');
      
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=transactions_report_${type}.csv`);
      res.send(csvString);
    } else if (format === 'print') {
      // Return HTML content for printing
      res.send(`
        <html>
          <head>
            <title>Transactions Report</title>
          </head>
          <style>
          body {
            font-family: Arial, sans-serif;
            background-color: #f4f4f4;
            margin: 0;
            padding: 0;
          }
          
          h1 {
            text-align: center;
            color: #333;
          }
          
          table {
            width: 80%;
            margin: 20px auto;
            border-collapse: collapse;
            background-color: #fff;
          }
          
          thead {
            background-color: #007bff;
            color: #fff;
          }
          
          th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
          }
          
          </style>
          <body>
            <h1>Transactions Report</h1>
            <table border="1">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                ${transactions.map((transaction) => `
                  <tr>
                    <td>${transaction.date}</td>
                    <td>${transaction.description}</td>
                    <td>${transaction.amount}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </body>
        </html>
      `);
    } else {
      // Handle unsupported format
      res.status(400).json({ message: 'Unsupported format' });
    }
  } catch (error) {
    console.error('Error exporting transactions:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});
// API endpoint to get budget limits
app.get('/api/budget-limits', async (req, res) => {
  try {
    // Fetch budget limits from the database
    const budgetLimits = await db.collection('budgetLimits').findOne({}); // Assuming there's only one set of limits for simplicity
    res.json(budgetLimits || {});
  } catch (error) {
    console.error('Error fetching budget limits:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// API endpoint to set budget limits
app.post('/api/budget-limits', async (req, res) => {
  const { category, limit } = req.body;

  try {
    // Upsert budget limits in the database
    await db.collection('budgetLimits').updateOne(
      {},
      { $set: { [category]: limit } },
      { upsert: true }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error setting budget limits:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});



  




// Add this API endpoint to fetch actual spending data
app.get('/api/actual-spending', async (req, res) => {
  try {
    const actualSpendingData = await db.collection('transactions').aggregate([
      { $match: { type: 'expense' } },
      {
        $group: {
          _id: '$category',
          categoryActualSpending: { $sum: { $toDouble: '$amount' } }
        }
      },
      {
        $project: {
          _id: 0,
          category: '$_id',
          categoryActualSpending: 1
        }
      }
    ]).toArray();

    res.json(actualSpendingData);
  } catch (error) {
    console.error('Error fetching actual spending data:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});
// Analytics route directly in server.js
app.get('/api/analytics/expense-distribution', async (req, res) => {
  try {
    const expenseDistribution = await db.collection('transactions').aggregate([
      {
        $match: { type: 'expense' } // Assuming 'type' field represents income or expense
      },
      {
        $group: {
          _id: '$category',
          totalAmount: { $sum: { $toDouble: '$amount' } }
        }
      },
      {
        $project: {
          _id: 0,
          category: '$_id',
          totalAmount: 1
        }
      }
    ]).toArray();

    const labels = expenseDistribution.map(item => item.category);
    const data = expenseDistribution.map(item => item.totalAmount);
    const colors = generateRandomColors(labels.length);

    res.json({ labels, data, colors });
  } catch (error) {
    console.error('Error fetching expense distribution data:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});



// Fetch income vs. expenses over time data
app.get('/api/analytics/income-expenses-over-time', async (req, res) => {
  try {
    const timeRange = req.query.timeRange || 'monthly';

    const matchQuery = getMatchQueryBasedOnTimeRange(timeRange);

    const incomeExpensesOverTime = await db.collection('transactions').aggregate([
      {
        $match: matchQuery
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$date' }
          },
          totalIncome: { $sum: { $cond: { if: { $eq: ['$type', 'income'] }, then: { $toDouble: '$amount' }, else: 0 } } },
          totalExpense: { $sum: { $cond: { if: { $eq: ['$type', 'expense'] }, then: { $toDouble: '$amount' }, else: 0 } } },
        }
      },
      {
        $sort: { _id: 1 }
      },
    ]).toArray();

    const labels = incomeExpensesOverTime.map(item => item._id);
    const incomeData = incomeExpensesOverTime.map(item => item.totalIncome);
    const expenseData = incomeExpensesOverTime.map(item => item.totalExpense);

    res.json({ labels, incomeData, expenseData });
  } catch (error) {
    console.error('Error fetching income vs. expenses over time data:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});


// Function to generate match query based on time range
function getMatchQueryBasedOnTimeRange(timeRange) {
  const currentDate = new Date();
  switch (timeRange) {
    case 'weekly':
      return { date: { $gte: new Date(currentDate.getTime() - 7 * 24 * 60 * 60 * 1000) } };
    case 'monthly':
      return { date: { $gte: new Date(currentDate.getFullYear(), currentDate.getMonth(), 1) } };
    case 'yearly':
      return { date: { $gte: new Date(currentDate.getFullYear(), 0, 1) } };
    default:
      return {};
  }
}

// API endpoint to get category-wise analysis data
app.get('/api/category-wise-analysis', async (req, res) => {
  try {
    // Fetch data from the database for category-wise analysis
    const categoryAnalysisData = await db.collection('transactions').aggregate([
      {
        $match: {
          type: { $in: ['income', 'expense'] }, // Filter by income and expense types
        },
      },
      {
        $group: {
          _id: '$category',
          totalAmount: { $sum: { $cond: { if: { $eq: ['$type', 'income'] }, then: { $toDouble: '$amount' }, else: { $multiply: [{ $toDouble: '$amount' }, -1] } } } },
        },
      },
      {
        $project: {
          _id: 0,
          category: '$_id',
          totalAmount: 1,
        },
      },
    ]).toArray();

    // Separate income and expense data
    const incomeData = categoryAnalysisData.filter(item => item.totalAmount > 0);
    const expenseData = categoryAnalysisData.filter(item => item.totalAmount < 0);

    // Prepare and send data for category-wise analysis
    const result = {
      income: {
        labels: incomeData.map(item => item.category),
        data: incomeData.map(item => Math.abs(item.totalAmount)),
        colors: generateRandomColors(incomeData.length),
      },
      expense: {
        labels: expenseData.map(item => item.category),
        data: expenseData.map(item => Math.abs(item.totalAmount)),
        colors: generateRandomColors(expenseData.length),
      },
    };

    res.json(result);
  } catch (error) {
    console.error('Error fetching category-wise analysis data:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});
// API endpoint to get daily income and expense data
app.get('/api/daily-income-expense', async (req, res) => {
  try {
    const currentDate = new Date();
    const startOfDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
    const endOfDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() + 1);

    const dailyData = await db.collection('transactions').aggregate([
      {
        $match: {
          date: { $gte: startOfDay, $lt: endOfDay },
          type: { $in: ['income', 'expense'] },
        },
      },
      {
        $group: {
          _id: '$type',
          totalAmount: { $sum: { $toDouble: '$amount' } },
        },
      },
      {
        $project: {
          _id: 0,
          type: '$_id',
          totalAmount: 1,
        },
      },
    ]).toArray();

    const result = {
      date: currentDate.toISOString().split('T')[0],
      income: dailyData.find(item => item.type === 'income')?.totalAmount || 0,
      expense: dailyData.find(item => item.type === 'expense')?.totalAmount || 0,
    };

    res.json(result);
  } catch (error) {
    console.error('Error fetching daily income and expense data:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});




// API endpoint to get category-wise spending trends
app.get('/api/analytics/category-spending-trends', async (req, res) => {
  const { timeRange } = req.query;

  try {
    // Fetch data from the database based on the time range
    const categorySpendingData = await db.collection('transactions').aggregate([
      {
        $match: {
          date: { $gte: new Date(new Date() - timeRange * 24 * 60 * 60 * 1000) },
          type: 'expense', // Consider only expenses
        },
      },
      {
        $group: {
          _id: '$category',
          data: { $push: '$amount' },
        },
      },
    ]).toArray();

    // Process the data for visualization
    const labels = Array.from({ length: timeRange }, (_, i) => i + 1).map(day => {
      const date = new Date(new Date() - (timeRange - day) * 24 * 60 * 60 * 1000);
      return date.toISOString().split('T')[0];
    });

    const categories = {};
    categorySpendingData.forEach(category => {
      categories[category._id] = Array.from({ length: timeRange }, (_, i) => {
        const dayData = category.data.find(data => new Date(data.date).toISOString().split('T')[0] === labels[i]);
        return dayData ? parseFloat(dayData.amount) : 0;
      });
    });

    const result = { labels, categories };
    res.json(result);
  } catch (error) {
    console.error('Error fetching category-wise spending trends:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});
// API endpoint to fetch top spending categories
app.get('/api/analytics/top-spending-categories', async (req, res) => {
  const { timeRange } = req.query;

  try {
    const topCategories = await getTopSpendingCategories(db, timeRange);
    res.json(topCategories);
  } catch (error) {
    console.error('Error sending top spending categories to frontend:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});


// Function to fetch top spending categories
const getTopSpendingCategories = async (db, timeRange) => {
  // Adjust the start and end dates based on your data
  const currentDate = new Date();
  const startDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - (timeRange - 1), 1); // Start of the current month
  const endDate = currentDate;
  console.log('Fetching top spending categories for the period:', startDate, 'to', endDate);

  const aggregationPipeline = [
    {
      $match: {
        date: { $gte: new Date(startDate), $lte: new Date(endDate) },
        type: 'expense',
      },
    },
    {
      $group: {
        _id: '$category',
        totalSpending: { $sum: { $toDouble: '$amount' } },
      },
    },
    {
      $sort: { totalSpending: -1 },
    },
    {
      $limit: 5,
    },
  ];

  try {
    console.log('Before aggregation:', await db.collection('transactions').find({ date: { $gte: startDate, $lte: endDate }, type: 'expense' }).toArray());

    const topCategories = await db.collection('transactions').aggregate(aggregationPipeline).toArray();

    console.log('Top Spending Categories:', topCategories);
    return topCategories;
  } catch (error) {
    console.error('Error during aggregation:', error);
    throw error;
  }
};

// API endpoint to get monthly spending trends
app.get('/api/analytics/monthly-trends', async (req, res) => {
  try {
    const timeRange = req.query.timeRange || 6; // Default to 6 months

    // Calculate the start date based on the time range
    const currentDate = new Date();
    const startDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - (timeRange - 1), 1);

    const monthlySpendingTrends = await db.collection('transactions').aggregate([
      {
        $match: {
          type: 'expense',
          date: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m', date: '$date' },
          },
          totalSpending: { $sum: { $toDouble: '$amount' } },
        },
      },
      {
        $sort: { _id: 1 },
      },
    ]).toArray();
    console.log('Monthly Spending Trends:', monthlySpendingTrends);


    const labels = monthlySpendingTrends.map(item => item._id);
    const data = monthlySpendingTrends.map(item => item.totalSpending);

    res.json({ labels, data });
  } catch (error) {
    console.error('Error fetching monthly spending trends:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});
// API endpoint to get calendar events with income and expense amounts for each date
app.get('/api/calendar-events', async (req, res) => {
  try {
    const calendarEvents = await db.collection('transactions').find().toArray();

    // Group transactions by date and calculate total income and expense for each date
    const groupedEvents = calendarEvents.reduce((acc, event) => {
      const dateKey = moment(event.date).format('YYYY-MM-DD');
      if (!acc[dateKey]) {
        acc[dateKey] = {
          id: dateKey,
          title: 'Daily Summary',
          start: moment(dateKey).toDate(),
          end: moment(dateKey).add(1, 'days').toDate(),
          income: 0,
          expense: 0,
          events: [],  // Store individual events for the selected date
        };
      }

      if (event.type === 'income') {
        acc[dateKey].income += event.amount;
      } else if (event.type === 'expense') {
        acc[dateKey].expense += event.amount;
      }

      // Store individual events for the selected date
      if (event.description) {
        acc[dateKey].events.push({
          id: event._id.toString(),
          title: event.description,
          description: event.description,
          category: event.category,
          amount: event.amount,
        });
      }

      return acc;
    }, {});

    // Convert the grouped events object to an array
    const events = Object.values(groupedEvents);

    res.json(events);
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});



// Function to generate random colors
function generateRandomColors(count) {
  const colors = [];
  for (let i = 0; i < count; i++) {
    const color = '#' + Math.floor(Math.random() * 16777215).toString(16); // Generate a random hex color
    colors.push(color);
  }
  return colors;
}
