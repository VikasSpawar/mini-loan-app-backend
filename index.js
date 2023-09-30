const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
require('dotenv').config();

const cors = require("cors");
const app = express();
const port = process.env.PORT || 3000;
const mongoUrl=process.env.MONGO_URL
// Connect to MongoDB

mongoose.connect(
  `${mongoUrl}`,
  {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  }
);

const Loan = mongoose.model("Loan", {
  amount: Number,
  term: Number,
  status: String,
  remainingAmount: Number,
});

const Repayment = mongoose.model("Repayment", {
  loan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Loan",
  },
  amount: Number,
  date: Date,
  status: String,
});

app.use(cors());
app.use(bodyParser.json());

app.get("/api/loans", async (req, res) => {
  try {
    // Retrieve all loans
    const loans = await Loan.find();

    const loanDetails = [];

    // Retrieve associated scheduled repayments for each loan
    for (const loan of loans) {
      const repayments = await Repayment.find({ loan: loan._id });
      loanDetails.push({ loan, repayments });
    }

    res.status(200).json(loans);
  } catch (error) {
    console.error("Error retrieving loans:", error);
    res.status(500).json({ error: "Error retrieving loans" });
  }
});

// Retrieve details of a specific loan by loanId
app.get("/api/loans/:loanId", async (req, res) => {
  try {
    const loanId = req.params.loanId;
    const loan = await Loan.findById({ _id: loanId });

    if (!loan) {
      return res.status(404).json({ error: "Loan not found" });
    }

    // Retrieve associated scheduled repayments for the loan
    const repayments = await Repayment.find({ loan: loanId });

    res.status(200).json({ repayments, loan });
  } catch (error) {
    console.error("Error retrieving loan details:", error);
    res.status(500).json({ error: "Error retrieving loan details" });
  }
});

app.delete("/api/loans/:loanId", async (req, res) => {
  const loanId = req.params.loanId;

  try {
    // Find the loan by its ID and remove it
    const deletedLoan = await Loan.findByIdAndRemove({ _id: loanId });

    if (!deletedLoan) {
      return res.status(404).json({ error: "Loan not found" });
    }

    res.status(200).json({ message: "Loan deleted successfully" });
  } catch (error) {
    console.error("Error deleting loan:", error);
    res.status(500).json({ error: "Error deleting loan" });
  }
});
// Create a new loan
app.post("/api/loans", async (req, res) => {
  try {
    const { amount, term } = req.body;

    const loan = new Loan({
      amount,
      term,
      status: "PENDING",
      remainingAmount: amount,
    });

    await loan.save();

    const startDate = new Date(); 
    createScheduledRepayments(loan._id, amount, term, startDate);

    res.status(201).json(loan);
  } catch (error) {
    console.error("Error creating loan:", error);
    res.status(500).json({ error: "Error creating loan" });
  }
});

// Function to create scheduled repayments for a loan
const createScheduledRepayments = async (
  loanId,
  loanAmount,
  term,
  startDate
) => {
  let repaymentAmount = calculateRepaymentAmount(loanAmount, term);

  let remainingDecimalsValue = 0;
  let repaymentFloorValue = repaymentAmount - Math.floor(repaymentAmount);
  let floorValue = Math.floor(repaymentAmount);

  for (let i = 0; i < term; i++) {
    remainingDecimalsValue += repaymentFloorValue;
    if (i == term - 1) {
      repaymentAmount =(remainingDecimalsValue + Math.floor(repaymentAmount));
    } else {
      repaymentAmount = floorValue;
    }

    const repayment = new Repayment({
      loan: loanId,
      amount: parseFloat(repaymentAmount),
      date: calculateRepaymentDate(startDate, i),
      status: "PENDING",
    });

    await repayment.save();
  }
};

// Calculate the repayment amount based on the loan amount and term
const calculateRepaymentAmount = (loanAmount, term) => {
  // Divide the loan amount by the term to calculate the weekly repayment amount
  return loanAmount / term;
};

// Calculate the repayment date based on the loan start date and index
const calculateRepaymentDate = (startDate, index) => {
  const repaymentDate = new Date(startDate);
  repaymentDate.setDate(repaymentDate.getDate() + index * 7); 
  return repaymentDate;
};

// Submit a repayment for a specific loan
app.post("/api/loans/:loanId/repayments", async (req, res) => {
  try {
    const loanId = req.params.loanId;
    const { amount, date } = req.body;
    const loanObjectId = new mongoose.Types.ObjectId(loanId);

    // Find the corresponding scheduled repayment for the specified loan and date
    const scheduledRepayment = await Repayment.findOne({
      _id: loanObjectId, 
      date,
      status: "PENDING",
    });

    if (!scheduledRepayment) {
      return res
        .status(400)
        .json({ error: "Repayment not found or already paid" });
    }

    if (amount < scheduledRepayment.amount) {
      return res
        .status(400)
        .json({ error: "Repayment amount is insufficient" });
    }
    if (amount > scheduledRepayment.amount) {
      return res
        .status(400)
        .json({ error: "Amount is greater than repayment" });
    }

    // Update the status of the scheduled repayment to "PAID"

    scheduledRepayment.status = "PAID";

    await scheduledRepayment.save(); 

    // Check if all scheduled repayments for the loan are "PAID"
    const allRepaymentsPaid =
      (await Repayment.find({
        loan: scheduledRepayment.loan,
        status: "PENDING",
      }).countDocuments()) === 0;

    const loan = await Loan.findById(scheduledRepayment.loan);

    loan.remainingAmount = Number(loan.remainingAmount - amount);
    await loan.save();

    if (allRepaymentsPaid) {
    
      loan.status = "PAID";
      await loan.save();
    }

    res.status(200).json({ message: "Repayment processed successfully" });
  } catch (error) {
    console.error("Error processing repayment:", error);
    res.status(500).json({ error: "Error processing repayment" });
  }
});

app.put("/api/loans/:loanId/approve", async (req, res) => {
  try {
    const loanId = req.params.loanId;

  
    const loan = await Loan.findById(loanId);

    if (!loan) {
      return res.status(404).json({ error: "Loan not found" });
    }

   
    const isAdmin = true; 

    if (!isAdmin) {
      return res
        .status(403)
        .json({ error: "Only admin users can approve loans" });
    }

    loan.status = "APPROVED";
    await loan.save();

    res.status(200).json({ message: "Loan approved successfully" });
  } catch (error) {
    console.error("Error approving loan:", error);
    res.status(500).json({ error: "Error approving loan" });
  }
});
app.put("/api/loans/:loanId/reject", async (req, res) => {
  try {
    const loanId = req.params.loanId;

    // Check if the loan exists
    const loan = await Loan.findById(loanId);

    if (!loan) {
      return res.status(404).json({ error: "Loan not found" });
    }

    
    const isAdmin = true; 

    if (!isAdmin) {
      return res
        .status(403)
        .json({ error: "Only admin users can approve loans" });
    }

    loan.status = "REJECTED";
    await loan.save();

    res.status(200).json({ message: "Loan rejected" });
  } catch (error) {
    console.error("Error approving loan:", error);
    res.status(500).json({ error: "Error approving loan" });
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
