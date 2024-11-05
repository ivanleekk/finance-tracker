import React from 'react';

export default function Dashboard() {
    return (
        <div style={{ padding: '20px' }}>
            <h1>Dashboard</h1>
            <p>Welcome to your finance tracker dashboard!</p>
            <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: '20px' }}>
                <div style={{ border: '1px solid #ccc', padding: '10px', borderRadius: '5px' }}>
                    <h2>Account Balance</h2>
                    <p>$5,000.00</p>
                </div>
                <div style={{ border: '1px solid #ccc', padding: '10px', borderRadius: '5px' }}>
                    <h2>Recent Transactions</h2>
                    <ul>
                        <li>Groceries: -$50.00</li>
                        <li>Salary: +$2,000.00</li>
                        <li>Utilities: -$150.00</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}
