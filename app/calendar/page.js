'use client';
import React, { useState, useEffect } from 'react';
import styles from './CalendarPage.module.css';
import { toast } from 'react-hot-toast';

export default function CalendarPage() {
  const [events, setEvents] = useState([]);

  const [filteredEvents, setFilteredEvents] = useState([]);
  const [date, setDate] = useState(new Date());
  const [filters, setFilters] = useState({
    state: true,
    country: true,
    international: false,
  });
  const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [eventDetails, setEventDetails] = useState([]);

  useEffect(() => {
    fetchEvents();
  }, [date]);

  useEffect(() => {
    applyFilters();
  }, [events, filters]);

  const fetchEvents = async () => {
    const apiToken = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiIzIiwianRpIjoiMGI1MDhlNTEzZjEzNTk0ZjdkM2Y5NTQzNTM0MmJlNjBiOTI2ODI5ZTI1YWRiYmU5OGQyOWU4OTY1Y2ZlZWJjNjc5YTgxY2Y5MzgwZGNhNDkiLCJpYXQiOjE3MjE4NTc1NDIuMDgzNzY1LCJuYmYiOjE3MjE4NTc1NDIuMDgzNzY5MSwiZXhwIjoyNjY4NTQ1OTQyLjA3ODIyMTgsInN1YiI6IjEyNzgxNCIsInNjb3BlcyI6W119.Yrxi95Egb8P8cDD7mfPGwYMMBn6UtYRD9eI2XMcAr0x_bbKF58DC1QdAUIiN_mM4-D9B3dJNKSSzx__-xsQQolJUb9xjVs3fDXkWYqyupwtYkl-nbBO5cora5ryd8Fl9MT_-x71PN_LtaeOstYlTWPvRZjNNgxNhPH4-PA5ij0nzgcTc8MPQLcEg8TSVA0_YmvU_I8UVLweRxjG8OypEIysHfsHDSQhrmPFWf0Bup6gD6HFay1P0owkuQPaIrQKxnOgmmClqbWg30d3lxQdah4jQOseP_XAwPqdTVX-Q2ZxkxkDDE2LXlaR7GZQVG9c8rPbUh_vJeHNuGNPWb4P3dyVCcGk90RrFFYVCZ9bS7D2Xeke_Ciz8jiHxhYftz5IKBR9YLMdFAAYdh08hOTXLHS2AY9IuOUCdGbksxkeA9zhtRFyqCRN5cji88WKO8kL5HyO0M-0mLCk5EI6o5dj-qqWJsQ7omjOQ5Q_CNXAp8YeC6bDQwGMLvSiNR6dP3Res4b-D86X7O2Uy0BFbQEBsct0h33jQdqLVQuYB9UaWKNecbd1F8niKGWgzP6IKN75Ps8Waskq3ipJmO1_3DBo9EB7EReMxqOvBcs1YWLFizAPiUG7k9zF1zB_-XQtC-3piTTQbXquQHlakC8YW9RgeeK9d0CK1ZYosfzDvv7ndwgg';
    const start = new Date(date.getFullYear(), date.getMonth(), 1).toISOString();
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0).toISOString();

    try {
      const response = await fetch(
        `https://www.robotevents.com/api/v2/events?season%5B%5D=190&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&myEvents=false&per_page=250`,
        {
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Error: ${response.status} - ${response.statusText}`);
      }

      const data = await response.json();
      setEvents(data.data);
    } catch (error) {
      toast.error(`Failed to fetch events: ${error.message}`);
      console.error('Error fetching events:', error);
    }
  };

  const applyFilters = () => {
    const filtered = events.filter((event) => {
      const isInState = event.location.region === 'Florida';
      const isInCountry = event.location.country === 'United States';
      const isInternational = event.location.country !== 'United States';

      if (filters.state && isInState) return true;
      if (filters.country && isInCountry) return true;
      if (filters.international && isInternational) return true;

      return false;
    });
    filterEventsByMonth(filtered);
  };

  const filterEventsByMonth = (eventsToFilter = events) => {
    const filtered = eventsToFilter.filter((event) => {
      const eventDate = new Date(event.start);
      return (
        eventDate.getMonth() === date.getMonth() &&
        eventDate.getFullYear() === date.getFullYear()
      );
    });

    setFilteredEvents(filtered);
  };

  const onMonthChange = (direction) => {
    const newDate = new Date(date);
    newDate.setMonth(date.getMonth() + direction);
    setDate(newDate);
  };

  const onFilterChange = (filterType) => {
    setFilters((prev) => ({ ...prev, [filterType]: !prev[filterType] }));
  };

  const toggleFilterDropdown = () => {
    setIsFilterDropdownOpen(!isFilterDropdownOpen);
  };

  const fetchEventDetails = async (eventId) => {
    const apiToken = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiIzIiwianRpIjoiMGI1MDhlNTEzZjEzNTk0ZjdkM2Y5NTQzNTM0MmJlNjBiOTI2ODI5ZTI1YWRiYmU5OGQyOWU4OTY1Y2ZlZWJjNjc5YTgxY2Y5MzgwZGNhNDkiLCJpYXQiOjE3MjE4NTc1NDIuMDgzNzY1LCJuYmYiOjE3MjE4NTc1NDIuMDgzNzY5MSwiZXhwIjoyNjY4NTQ1OTQyLjA3ODIyMTgsInN1YiI6IjEyNzgxNCIsInNjb3BlcyI6W119.Yrxi95Egb8P8cDD7mfPGwYMMBn6UtYRD9eI2XMcAr0x_bbKF58DC1QdAUIiN_mM4-D9B3dJNKSSzx__-xsQQolJUb9xjVs3fDXkWYqyupwtYkl-nbBO5cora5ryd8Fl9MT_-x71PN_LtaeOstYlTWPvRZjNNgxNhPH4-PA5ij0nzgcTc8MPQLcEg8TSVA0_YmvU_I8UVLweRxjG8OypEIysHfsHDSQhrmPFWf0Bup6gD6HFay1P0owkuQPaIrQKxnOgmmClqbWg30d3lxQdah4jQOseP_XAwPqdTVX-Q2ZxkxkDDE2LXlaR7GZQVG9c8rPbUh_vJeHNuGNPWb4P3dyVCcGk90RrFFYVCZ9bS7D2Xeke_Ciz8jiHxhYftz5IKBR9YLMdFAAYdh08hOTXLHS2AY9IuOUCdGbksxkeA9zhtRFyqCRN5cji88WKO8kL5HyO0M-0mLCk5EI6o5dj-qqWJsQ7omjOQ5Q_CNXAp8YeC6bDQwGMLvSiNR6dP3Res4b-D86X7O2Uy0BFbQEBsct0h33jQdqLVQuYB9UaWKNecbd1F8niKGWgzP6IKN75Ps8Waskq3ipJmO1_3DBo9EB7EReMxqOvBcs1YWLFizAPiUG7k9zF1zB_-XQtC-3piTTQbXquQHlakC8YW9RgeeK9d0CK1ZYosfzDvv7ndwgg';
    try {
      const response = await fetch(
        `https://www.robotevents.com/api/v2/events/${eventId}/teams?myTeams=false&per_page=250`,
        {
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
  
      if (!response.ok) {
        throw new Error(`Error: ${response.status} - ${response.statusText}`);
      }
  
      const data = await response.json();
      setEventDetails(data.data || []); // Set event details to the 'data' array from the API response
    } catch (error) {
      toast.error(`Failed to fetch event details: ${error.message}`);
      console.error('Error fetching event details:', error);
      setEventDetails([]); // Fallback to an empty array in case of error
    }
  };
  

  const onEventClick = (event) => {
    setSelectedEvent(event);
    console.log(event.id);
    fetchEventDetails(event.id);
  };

  const renderCalendarDays = () => {
    const startDay = new Date(date.getFullYear(), date.getMonth(), 1).getDay();
    const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    const days = [];

    for (let i = 0; i < startDay; i++) {
      days.push(<div key={`empty-${i}`} className={styles.emptyDay}></div>);
    }

    for (let i = 1; i <= daysInMonth; i++) {
      const currentDate = new Date(date.getFullYear(), date.getMonth(), i);
      const dayEvents = filteredEvents.filter(
        (event) => new Date(event.start).toDateString() === currentDate.toDateString()
      );

      days.push(
        <div key={i} className={styles.calendarDay}>
          <span className={styles.dayNumber}>{i}</span>
          {dayEvents.length > 0 && (
            <div className={styles.events}>
              {dayEvents.map((event) => (
                <button
                  key={event.id}
                  className={styles.eventButton}
                  onClick={() => onEventClick(event)}
                >
                  {event.name}
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }

    return days;
  };

  return (
    <div className={styles.container}>
      <h1>Robot Events Calendar</h1>
      <div className={styles.controls}>
        <div className={styles.monthNavigation}>
        <button className={styles.button} onClick={() => onMonthChange(-1)}>Previous Month</button>
          <span className={styles.monthName}>
            {date.toLocaleString('default', { month: 'long' })} {date.getFullYear()}
          </span>
          <button className={styles.button} onClick={() => onMonthChange(1)}>Next Month</button>
        </div>
        <div className={styles.filterDropdownContainer}>
        <button className={styles.filterButton} onClick={toggleFilterDropdown}>
        <svg className={styles.hamburgerIcon} width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 12h18M3 6h18M3 18h18" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
          {isFilterDropdownOpen && (
            <div className={styles.filterDropdown}>
              <label>
                <input
                  type="checkbox"
                  checked={filters.state}
                  onChange={() => onFilterChange('state')}
                />
                Competitions in Your State
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={filters.country}
                  onChange={() => onFilterChange('country')}
                />
                Competitions in Your Country
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={filters.international}
                  onChange={() => onFilterChange('international')}
                />
                International Competitions
              </label>
            </div>
          )}
        </div>
      </div>
      <div className={styles.calendarContainer}>
        <div className={styles.calendar}>
          <div className={styles.weekDays}>
            <div>Sun</div>
            <div>Mon</div>
            <div>Tue</div>
            <div>Wed</div>
            <div>Thu</div>
            <div>Fri</div>
            <div>Sat</div>
          </div>
          <div className={styles.calendarDays}>
            {renderCalendarDays()}
          </div>
        </div>
        <div className={styles.eventDetails}>
  {selectedEvent ? (
    <div>
      <h2>{selectedEvent.name}</h2>
      <p>{selectedEvent.location.city}, {selectedEvent.location.region}</p>
      <p>{selectedEvent.start} - {selectedEvent.end}</p>
      <h3>Teams Registered:</h3>
      <ul>
        {Array.isArray(eventDetails) && eventDetails.length > 0 ? (
          eventDetails.map((team) => (
            <li key={team.id}>
              {team.number} - {team.team_name} ({team.location.city}, {team.location.region})
            </li>
          ))
        ) : (
          <p>No teams registered yet.</p>
        )}
      </ul>
    </div>
  ) : (
    <p>Select an event to see details</p>
  )}
</div>



      </div>
    </div>
  );
}
