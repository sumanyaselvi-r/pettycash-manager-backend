// index.js
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const dotenv = require('dotenv');
const PDFDocument = require('pdfkit');
const csv = require('fast-csv');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const jsonwebtoken = require('jsonwebtoken');
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
// Registration endpoint
app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;

  try {
    // Check if the username or email already exists
    const existingUser = await db.collection('users').findOne({ $or: [{ username }, { email }] });

    if (existingUser) {
      return res.status(409).json({ message: 'Username or email already exists' });
    }

    // Hash the password before storing it
    const hashedPassword = await bcrypt.hash(password, 10);

    // Save user data to the database
    const result = await db.collection('users').insertOne({
      username,
      email,
      password: hashedPassword,
    });

    res.status(201).json({ message: 'User registered successfully', userId: result.insertedId });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// API endpoint for user login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    // Find the user by username
    const user = await db.collection('users').findOne({ username });
    if (!user) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    // Compare the provided password with the hashed password
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    // Generate a JWT token
    const token = jwt.sign({ userId: user._id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '1h' });
   
    // Send user details along with the token
    res.json({
      token,
      user: {
        userId: user._id,
        username: user.username,
        token,
       
       
      },
    });
  

   console.log('login');
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});
app.post('/api/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    const user = await db.collection('users').findOne({ email });

    if (!user) {
      console.log('User not registered');
      return res.status(404).json({ message: 'User not registered' });
    }

    const token = jsonwebtoken.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

    await db.collection('users').updateOne({ email }, {
      $set: { token }
    });

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });

    const info = await transporter.sendMail({
      from: process.env.MAIL_ID,
      to: email,
      subject: 'Reset password link',
      text: `Click the following link to reset your password: http://localhost:3000/reset-password/${token}`
    });

    console.log('Password reset link sent successfully.');
    res.json({ message: 'Password reset link sent successfully.' });
  } catch (error) {
    console.error('Failed to send password reset email:', error);
    res.status(500).json({ message: 'Failed to send password reset email.' });
  }
});
app.post("/reset-password/:token", async (req, res) => {
  try {
    const { password, confirmPassword } = req.body;
    let token = req.params.token;

    // Remove leading colon if present
    token = token.replace(/^:/, '');

    jsonwebtoken.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
      if (err) {
        console.error('Error with token:', err);
        return res.status(400).json({ message: 'Error with token' });
      }

      try {
        const hashedPassword = await bcrypt.hash(password, 10);

        await db.collection("users").updateOne({ token }, {
          $set: {
            password: hashedPassword,
            // Assuming you want to store confirmPassword, you might want to remove this line if not needed
            confirmPassword: hashedPassword
          }
        });

        console.log('Password changed successfully.');
        res.json({ message: 'Password changed successfully' });
      } catch (error) {
        console.error('Failed to reset password:', error);
        res.status(500).json({ message: 'Failed to reset password' });
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});
// API endpoint to get all transactions

const authenticateToken = (req, res, next) => {
  const token = req.headers.authorization && req.headers.authorization.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Unauthorized: Missing token' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Forbidden: Invalid token' });
    }

    req.user = user;  
    next();
  });
};
app.use(authenticateToken)
// API endpoint to get all transactions with optional sorting

app.get('/api/transactions',  async (req, res) => {
  try {
    // Convert 'amount' field from string to number
    await db.collection('transactions').find({ amount: { $type: 'string' } }).forEach(async function (doc) {
      await db.collection('transactions').updateOne({ _id: doc._id }, { $set: { amount: parseFloat(doc.amount) } });
    });

    // Fetch transactions for the authenticated user with sorting
    const userId = req.user.userId;
    let sortBy = req.query.sortBy || 'date';
    const sortOrder = sortBy === 'date' ? -1 : 1; // -1 for descending, 1 for ascending
    const searchTerm = req.query.searchTerm || ''; // Extract search term from query

    const query = {
      userId: userId, // Add this condition to filter transactions by user ID
      ...(searchTerm ? { description: { $regex: new RegExp(searchTerm, 'i') } } : {}), // Add search condition if searchTerm is provided
    };

    const transactions = await db.collection('transactions').find(query).sort({ [sortBy]: sortOrder }).toArray();

    res.json(transactions);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});


app.post('/api/transactions', async (req, res) => {
  console.log('Request Body:', req.body);
  try {
       // Extract transaction data from the request body
       const { date, description, amount, category, type } = req.body;
       const userId = req.user.userId;  // Extract userId from the authenticated user
   
       // Convert the 'amount' field from string to number
       const numericAmount = parseFloat(amount);
   
       // Create a new transaction object
       const newTransaction = {
         date,
         description,
         amount: numericAmount,
         category,
         type,
         userId,
       };
   
       // Insert the new transaction into the 'transactions' collection
       const result = await db.collection('transactions').insertOne(newTransaction);
   
       // Return the inserted transaction with the generated ID
       const insertedTransaction = {
         _id: result.insertedId,
         ...newTransaction,
       };
   
       res.status(201).json(insertedTransaction);
       console.log(insertedTransaction);
     } catch (error) {
       console.error('Error adding transaction:', error);
       res.status(500).json({ message: 'Internal Server Error' });
     }
});
// API endpoint to edit a transaction
app.put('/api/transactions/:id',  async (req, res) => {
  const { id } = req.params;
  const updatedTransaction = req.body;

  // Extract userId from the authenticated user
  const userId = req.user.userId;

  // Exclude the _id and userId fields from the update
  delete updatedTransaction._id;
  delete updatedTransaction.userId;

  try {
    const result = await db
      .collection('transactions')
      .findOneAndUpdate(
        { _id: new ObjectId(id), userId: userId }, // Ensure both transaction ID and userId match
        { $set: updatedTransaction },
        { returnDocument: 'after' }
      );

    if (!result.value) {
      // Handle the case where the updated transaction is not found or doesn't belong to the user
      console.error('Error updating transaction: Transaction not found or unauthorized');
      res.status(404).json({ message: 'Transaction not found or unauthorized' });
    } else {
      res.json({ message: 'Transaction updated successfully', data: result.value });
    }
  } catch (error) {
    console.error('Error updating transaction:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});



app.delete('/api/transactions/:id', async (req, res) => {
  const { id } = req.params;

  // Extract userId from the request's decoded token (provided by the authenticateToken middleware)
  const userId = req.user.userId;

  try {
    const result = await db.collection('transactions').deleteOne({
      _id: new ObjectId(id),
      userId: userId, // Ensure the transaction belongs to the authenticated user
    });

    if (result.deletedCount === 0) {
      // Handle the case where the transaction is not found or doesn't belong to the user
      console.error('Error deleting transaction: Transaction not found or unauthorized');
      res.status(404).json({ message: 'Transaction not found or unauthorized' });
    } else {
      res.json({ message: 'Transaction deleted successfully' });
    }
  } catch (error) {
    console.error('Error deleting transaction:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});;
app.get('/api/transaction-summary', authenticateToken, async (req, res) => {
  try {
    // Use req.user to access the authenticated user's information
    const summary = await db.collection('transactions').aggregate([
      {
        $match: { userId: req.user.userId } // Filter transactions by userId
      },
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

app.get('/api/transactions/report',  async (req, res) => {
  try {
    let transactions;

    const reportType = req.query.type;
   
    const { userId } = req.user;
    if (reportType === 'monthly') {
      const currentDate = new Date();
      const startOfMonth = `${currentDate.getFullYear()}-${(currentDate.getMonth() + 1).toString().padStart(2, '0')}-01`;
      const endOfMonth = `${currentDate.getFullYear()}-${(currentDate.getMonth() + 2).toString().padStart(2, '0')}-01`;

      transactions = await db.collection('transactions').find({
        userId: userId, // Ensure the transactions belong to the authenticated user
        date: { $gte: startOfMonth, $lt: endOfMonth }
      }).sort({ date: 1 }).toArray();
    } else if (reportType === 'yearly') {
      const startOfYear = `${new Date().getFullYear()}-01-01`;
      const endOfYear = `${new Date().getFullYear() + 1}-01-01`;

      transactions = await db.collection('transactions').find({
        userId: userId, // Ensure the transactions belong to the authenticated user
        date: { $gte: startOfYear, $lt: endOfYear }
      }).sort({ date: 1 }).toArray();
    } else if (reportType === 'custom') {
      const startDate = req.query.startDate; // Assuming startDate is in "YYYY-MM-DD" format
      const endDate = req.query.endDate;     // Assuming endDate is in "YYYY-MM-DD" format

      transactions = await db.collection('transactions').find({
        userId: userId, // Ensure the transactions belong to the authenticated user
        date: { $gte: startDate, $lt: endDate }
      }).sort({ date: 1 }).toArray();
    } else {
      transactions = await db.collection('transactions').find({
        userId: userId // Ensure the transactions belong to the authenticated user
      }).sort({ date: 1 }).toArray();
    }

    res.json(transactions);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});



// API endpoint to export transactions as PDF, CSV, or for printing
app.get('/api/transactions/export',  async (req, res) => {
 

  try {
    const { type, format} = req.query;
    let transactions;
    const userId = req.user.userId;
    if (type === 'all') {
      transactions = await db.collection('transactions').find({ userId }).toArray();
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


// API endpoint to get top expenses
app.get('/api/top-expenses',  async (req, res) => {
  try {
    // Use req.user to access the authenticated user's information
    const userId = req.user.userId;

    // Set the number of top expenses to retrieve
    const limit = parseInt(req.query.limit) || 5;

    // Fetch top expenses for the authenticated user by sorting transactions in descending order of amount
    const topExpenses = await db.collection('transactions')
      .find({ userId }) // Filter transactions by userId
      .sort({ amount: -1 })
      .limit(limit)
      .toArray();

    res.json(topExpenses);
  } catch (error) {
    console.error('Error fetching top expenses:', error); // Log the error details
    res.status(500).json({ message: 'Internal Server Error' });
  }
});



// Analytics route directly in server.js
app.get('/api/analytics/expense-distribution',  async (req, res) => {
  try {
    const expenseDistribution = await db.collection('transactions').aggregate([
      {
        $match: { type: 'expense', userId: req.user.userId } // Assuming 'type' field represents income or expense
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
app.get('/api/analytics/income-expenses-over-time',  async (req, res) => {
  
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
app.get('/api/analytics/top-spending-categories',  async (req, res) => {
 
  const { timeRange } = req.query;

  try {
    const topCategories = await getTopSpendingCategories(db,timeRange);
    res.json(topCategories);
  } catch (error) {
    console.error('Error sending top spending categories to frontend:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Function to fetch top spending categories
const getTopSpendingCategories = async (db,  timeRange) => {
  // Adjust the start and end dates based on your data
  const currentDate = new Date();
  const startDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - (timeRange - 1), 1); // Start of the current month
  const endDate = currentDate;

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
   

    const topCategories = await db.collection('transactions').aggregate(aggregationPipeline).toArray();

    
    return topCategories;
  } catch (error) {
    console.error('Error during aggregation:', error);
    throw error;
  }
};

// API endpoint to get monthly spending trends

app.get('/api/analytics/monthly-trends',  async (req, res) => {
  try {
    const timeRange = req.query.timeRange || 6; // Default to 6 months

    // Calculate the start date based on the time range
    const currentDate = new Date();
    const startDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - (timeRange - 1), 1);

    const userId = req.user.userId; // Extract userId from the authenticated user

    const monthlySpendingTrends = await db.collection('transactions').aggregate([
      {
        $match: {
          userId: userId,
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

    const labels = monthlySpendingTrends.map(item => item._id);
    const data = monthlySpendingTrends.map(item => item.totalSpending);

    res.json({ labels, data });
  } catch (error) {
    console.error('Error fetching monthly spending trends:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});
// API endpoint to get calendar events with income and expense amounts for each date
app.get('/api/calendar-events', authenticateToken, async (req, res) => {
  const userId = req.user.userId; // Extract userId from the authenticated user

  try {
    const calendarEvents = await db.collection('transactions').find({ userId }).toArray();

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
// API endpoint for user signup

// Middleware to check if a valid JWT token is present in the request headers



// API endpoint for user logout (token invalidation)
app.post('/api/logout', (req, res) => {
  // You may implement additional logic for token invalidation (e.g., blacklisting)
  res.json({ message: 'Logout successful' });
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

